#define _DARWIN_C_SOURCE
#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <libproc.h>
#include <sys/event.h>
#include <sys/time.h>
#elif defined(__linux__)
#include <poll.h>
#include <sys/signalfd.h>
#include <sys/syscall.h>
#endif

#define EXIT_USAGE 64
#define EXIT_SETUP 70
#define FORCE_GRACE_MILLISECONDS 10000
#define CONTROL_BUFFER_SIZE 512

typedef struct {
  pid_t pid;
  uint64_t started_high;
  uint64_t started_low;
} process_identity;

static void report_error(const char *message) {
  int saved_errno = errno;
  char buffer[512];
  int length =
      snprintf(buffer, sizeof(buffer), "translator-owner-supervisor: %s: %s\n",
               message, strerror(saved_errno));
  if (length > 0) {
    size_t count = (size_t)length;
    if (count >= sizeof(buffer))
      count = sizeof(buffer) - 1;
    (void)write(STDERR_FILENO, buffer, count);
  }
}

static int parse_positive_pid(const char *value, pid_t *result) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed <= 1 ||
      parsed > INT32_MAX) {
    return -1;
  }
  *result = (pid_t)parsed;
  return 0;
}

static int parse_positive_int(const char *value, int *result) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed <= 0 ||
      parsed > 64) {
    return -1;
  }
  *result = (int)parsed;
  return 0;
}

static int same_identity(const process_identity *left,
                         const process_identity *right) {
  return left->pid == right->pid && left->started_high == right->started_high &&
         left->started_low == right->started_low;
}

static int identity_started_after(const process_identity *left,
                                  const process_identity *right) {
  if (left->started_high != right->started_high) {
    return left->started_high > right->started_high;
  }
  return left->started_low > right->started_low;
}

#if defined(__APPLE__)

static int read_identity(pid_t pid, process_identity *identity, pid_t *parent) {
  struct proc_bsdinfo info;
  memset(&info, 0, sizeof(info));
  int bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  if (bytes != (int)sizeof(info)) {
    errno = ESRCH;
    return -1;
  }
  identity->pid = pid;
  identity->started_high = info.pbi_start_tvsec;
  identity->started_low = info.pbi_start_tvusec;
  if (parent != NULL)
    *parent = (pid_t)info.pbi_ppid;
  return 0;
}

static int register_process(int queue, const process_identity *identity,
                            intptr_t tag) {
  struct kevent change;
  EV_SET(&change, (uintptr_t)identity->pid, EVFILT_PROC,
         EV_ADD | EV_ENABLE | EV_CLEAR, NOTE_EXIT, 0, (void *)tag);
  return kevent(queue, &change, 1, NULL, 0, NULL);
}

static int register_read(int queue, int descriptor, intptr_t tag) {
  struct kevent change;
  EV_SET(&change, (uintptr_t)descriptor, EVFILT_READ,
         EV_ADD | EV_ENABLE | EV_CLEAR, 0, 0, (void *)tag);
  return kevent(queue, &change, 1, NULL, 0, NULL);
}

static int register_signal(int queue, int signal_number, intptr_t tag) {
  struct kevent change;
  if (signal(signal_number, SIG_IGN) == SIG_ERR)
    return -1;
  EV_SET(&change, (uintptr_t)signal_number, EVFILT_SIGNAL,
         EV_ADD | EV_ENABLE | EV_CLEAR, 0, 0, (void *)tag);
  return kevent(queue, &change, 1, NULL, 0, NULL);
}

#elif defined(__linux__)

static int read_identity(pid_t pid, process_identity *identity, pid_t *parent) {
  char path[64];
  int path_length = snprintf(path, sizeof(path), "/proc/%d/stat", (int)pid);
  if (path_length <= 0 || (size_t)path_length >= sizeof(path)) {
    errno = EINVAL;
    return -1;
  }

  int descriptor = open(path, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0)
    return -1;
  char buffer[4096];
  ssize_t bytes = read(descriptor, buffer, sizeof(buffer) - 1);
  int saved_errno = errno;
  close(descriptor);
  errno = saved_errno;
  if (bytes <= 0)
    return -1;
  buffer[bytes] = '\0';

  char *fields = strrchr(buffer, ')');
  if (fields == NULL || fields[1] != ' ') {
    errno = EPROTO;
    return -1;
  }
  fields += 2;

  char *save = NULL;
  char *token = strtok_r(fields, " ", &save);
  int field_number = 3;
  pid_t parsed_parent = 0;
  uint64_t start_ticks = 0;
  while (token != NULL) {
    if (field_number == 4)
      parsed_parent = (pid_t)strtol(token, NULL, 10);
    if (field_number == 22) {
      start_ticks = strtoull(token, NULL, 10);
      break;
    }
    token = strtok_r(NULL, " ", &save);
    field_number += 1;
  }
  if (parsed_parent <= 0 || start_ticks == 0) {
    errno = EPROTO;
    return -1;
  }

  identity->pid = pid;
  identity->started_high = 0;
  identity->started_low = start_ticks;
  if (parent != NULL)
    *parent = parsed_parent;
  return 0;
}

static int open_process_descriptor(pid_t pid) {
#ifdef SYS_pidfd_open
  return (int)syscall(SYS_pidfd_open, pid, 0);
#else
  (void)pid;
  errno = ENOSYS;
  return -1;
#endif
}

#else
#error                                                                         \
    "translator-owner-supervisor supports macOS and Linux in this source file"
#endif

static int identity_is_live(const process_identity *expected) {
  process_identity current;
  if (read_identity(expected->pid, &current, NULL) != 0)
    return 0;
  return same_identity(expected, &current);
}

static void kill_identity(const process_identity *identity, int process_group) {
  if (identity == NULL || identity->pid <= 1 || !identity_is_live(identity)) {
    return;
  }
  if (process_group)
    (void)kill(-identity->pid, SIGKILL);
  (void)kill(identity->pid, SIGKILL);
}

static void kill_unreaped_child_group(pid_t child_pid) {
  if (child_pid <= 1)
    return;
  /*
   * The supervisor remains this root's parent until waitpid() below. Its PID
   * therefore cannot be reused, even when platform process APIs stop
   * reporting an exited zombie. The process-group identity stays exact and
   * can still contain Electron descendants after the root exits.
   */
  (void)kill(-child_pid, SIGKILL);
  (void)kill(child_pid, SIGKILL);
}

static int validate_relationship(pid_t owner_pid, pid_t controller_pid,
                                 process_identity *owner,
                                 process_identity *controller) {
  pid_t actual_parent = 0;
  if (read_identity(controller_pid, controller, &actual_parent) != 0 ||
      actual_parent != owner_pid ||
      read_identity(owner_pid, owner, NULL) != 0 ||
      identity_started_after(owner, controller)) {
    errno = ESRCH;
    return -1;
  }
  return 0;
}

static int write_ready(void) {
  static const char ready[] = "READY\n";
  size_t written = 0;
  while (written < sizeof(ready) - 1) {
    ssize_t count =
        write(STDOUT_FILENO, ready + written, sizeof(ready) - 1 - written);
    if (count > 0) {
      written += (size_t)count;
      continue;
    }
    if (count < 0 && errno == EINTR)
      continue;
    return -1;
  }
  return 0;
}

typedef struct {
  char bytes[CONTROL_BUFFER_SIZE];
  size_t length;
  process_identity tracked;
  int has_tracked;
  int closing;
} control_state;

static int apply_control_line(control_state *state, const char *line,
                              pid_t controller_pid
#if defined(__APPLE__)
                              ,
                              int queue
#elif defined(__linux__)
                              ,
                              int *tracked_descriptor
#endif
) {
  if (strcmp(line, "CLOSING") == 0) {
    state->closing = 1;
    return 1;
  }

  char action[16];
  long raw_pid = 0;
  char trailing = '\0';
  if (sscanf(line, "%15s %ld %c", action, &raw_pid, &trailing) != 2 ||
      raw_pid <= 1 || raw_pid > INT32_MAX) {
    errno = EPROTO;
    return -1;
  }
  pid_t pid = (pid_t)raw_pid;

  if (strcmp(action, "UNTRACK") == 0) {
    if (state->has_tracked && state->tracked.pid == pid) {
      (void)kill(-state->tracked.pid, SIGKILL);
      state->has_tracked = 0;
#if defined(__linux__)
      if (*tracked_descriptor >= 0)
        close(*tracked_descriptor);
      *tracked_descriptor = -1;
#endif
    }
    return 0;
  }
  if (strcmp(action, "TRACK") != 0) {
    errno = EPROTO;
    return -1;
  }

  if (state->has_tracked && state->tracked.pid != pid) {
    errno = EBUSY;
    return -1;
  }

  process_identity candidate;
  pid_t candidate_parent = 0;
  if (read_identity(pid, &candidate, &candidate_parent) != 0 ||
      candidate_parent != controller_pid) {
    errno = EPERM;
    return -1;
  }

#if defined(__APPLE__)
  if (register_process(queue, &candidate, 4) != 0)
    return -1;
  process_identity verified;
  pid_t verified_parent = 0;
  if (read_identity(pid, &verified, &verified_parent) != 0 ||
      verified_parent != controller_pid ||
      !same_identity(&candidate, &verified)) {
    errno = ESRCH;
    return -1;
  }
#elif defined(__linux__)
  int descriptor = open_process_descriptor(pid);
  if (descriptor < 0)
    return -1;
  process_identity verified;
  pid_t verified_parent = 0;
  if (read_identity(pid, &verified, &verified_parent) != 0 ||
      verified_parent != controller_pid ||
      !same_identity(&candidate, &verified)) {
    close(descriptor);
    errno = ESRCH;
    return -1;
  }
  if (*tracked_descriptor >= 0)
    close(*tracked_descriptor);
  *tracked_descriptor = descriptor;
#endif

  state->tracked = candidate;
  state->has_tracked = 1;
  return 0;
}

static int consume_control(control_state *state, pid_t controller_pid
#if defined(__APPLE__)
                           ,
                           int queue
#elif defined(__linux__)
                           ,
                           int *tracked_descriptor
#endif
) {
  char chunk[256];
  ssize_t count = read(STDIN_FILENO, chunk, sizeof(chunk));
  if (count == 0)
    return state->closing ? 1 : 2;
  if (count < 0) {
    if (errno == EINTR || errno == EAGAIN)
      return 0;
    return -1;
  }
  if (state->length + (size_t)count > sizeof(state->bytes)) {
    errno = EOVERFLOW;
    return -1;
  }
  memcpy(state->bytes + state->length, chunk, (size_t)count);
  state->length += (size_t)count;

  size_t consumed = 0;
  for (size_t index = 0; index < state->length; index += 1) {
    if (state->bytes[index] != '\n')
      continue;
    state->bytes[index] = '\0';
    int result =
        apply_control_line(state, state->bytes + consumed, controller_pid
#if defined(__APPLE__)
                           ,
                           queue
#elif defined(__linux__)
                           ,
                           tracked_descriptor
#endif
        );
    if (result != 0)
      return result;
    consumed = index + 1;
  }
  if (consumed > 0) {
    memmove(state->bytes, state->bytes + consumed, state->length - consumed);
    state->length -= consumed;
  }
  return 0;
}

#if defined(__APPLE__)

static int run_watcher(pid_t owner_pid, pid_t controller_pid) {
  process_identity owner;
  process_identity controller;
  if (validate_relationship(owner_pid, controller_pid, &owner, &controller) !=
      0) {
    report_error("owner/controller relationship is no longer valid");
    return EXIT_SETUP;
  }

  int queue = kqueue();
  if (queue < 0 || register_process(queue, &owner, 1) != 0 ||
      register_process(queue, &controller, 2) != 0 ||
      register_read(queue, STDIN_FILENO, 3) != 0) {
    report_error("cannot arm process ownership monitor");
    if (queue >= 0)
      close(queue);
    return EXIT_SETUP;
  }

  process_identity verified_owner;
  process_identity verified_controller;
  if (validate_relationship(owner_pid, controller_pid, &verified_owner,
                            &verified_controller) != 0 ||
      !same_identity(&owner, &verified_owner) ||
      !same_identity(&controller, &verified_controller)) {
    close(queue);
    return EXIT_SETUP;
  }

  if (write_ready() != 0) {
    close(queue);
    return EXIT_SETUP;
  }
  (void)close(STDOUT_FILENO);

  control_state state;
  memset(&state, 0, sizeof(state));
  for (;;) {
    struct kevent events[8];
    int count = kevent(queue, NULL, 0, events, 8, NULL);
    if (count < 0) {
      if (errno == EINTR)
        continue;
      report_error("ownership monitor wait failed");
      kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
      kill_identity(&controller, 0);
      close(queue);
      return EXIT_SETUP;
    }

    int owner_exited = 0;
    int controller_exited = 0;
    int control_ready = 0;
    for (int index = 0; index < count; index += 1) {
      intptr_t tag = (intptr_t)events[index].udata;
      if (tag == 4) {
        if (state.has_tracked &&
            (pid_t)events[index].ident == state.tracked.pid) {
          (void)kill(-state.tracked.pid, SIGKILL);
          state.has_tracked = 0;
        }
      } else if (tag == 1) {
        owner_exited = 1;
      } else if (tag == 2) {
        controller_exited = 1;
      } else if (tag == 3) {
        control_ready = 1;
      }
    }
    if (owner_exited || controller_exited) {
      kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
      if (owner_exited)
        kill_identity(&controller, 0);
      close(queue);
      return 0;
    }
    if (control_ready) {
      int control = consume_control(&state, controller_pid, queue);
      if (control == 0)
        continue;
      if (control == 1) {
        kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
        close(queue);
        return 0;
      }
      kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
      kill_identity(&controller, 0);
      close(queue);
      return control < 0 ? EXIT_SETUP : 0;
    }
  }
}

static int walk_owner(int depth, process_identity *owner) {
  process_identity current;
  pid_t parent = 0;
  if (read_identity(getpid(), &current, &parent) != 0) {
    errno = ESRCH;
    return -1;
  }
  for (int level = 0; level < depth; level += 1) {
    if (parent <= 1) {
      errno = ESRCH;
      return -1;
    }
    process_identity next;
    pid_t next_parent = 0;
    if (read_identity(parent, &next, &next_parent) != 0 ||
        identity_started_after(&next, &current)) {
      errno = ESRCH;
      return -1;
    }
    process_identity verified;
    pid_t verified_parent = 0;
    if (read_identity(current.pid, &verified, &verified_parent) != 0 ||
        !same_identity(&current, &verified) || verified_parent != parent) {
      errno = ESRCH;
      return -1;
    }
    current = next;
    parent = next_parent;
  }
  *owner = current;
  return 0;
}

static long long monotonic_milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0)
    return -1;
  return (long long)now.tv_sec * 1000LL + now.tv_nsec / 1000000LL;
}

static int child_status_code(int status) {
  if (WIFEXITED(status))
    return WEXITSTATUS(status);
  if (WIFSIGNALED(status))
    return 128 + WTERMSIG(status);
  return EXIT_SETUP;
}

static int wait_for_child(pid_t child_pid) {
  int status = 0;
  for (;;) {
    pid_t result = waitpid(child_pid, &status, 0);
    if (result == child_pid)
      return child_status_code(status);
    if (result < 0 && errno == EINTR)
      continue;
    return EXIT_SETUP;
  }
}

static int run_supervisor(int owner_depth, char **command) {
  process_identity owner;
  if (walk_owner(owner_depth, &owner) != 0) {
    report_error("cannot resolve controlling owner process");
    return EXIT_SETUP;
  }

  int queue = kqueue();
  if (queue < 0 || register_process(queue, &owner, 1) != 0 ||
      register_signal(queue, SIGINT, 3) != 0 ||
      register_signal(queue, SIGTERM, 3) != 0 ||
      register_signal(queue, SIGHUP, 3) != 0) {
    report_error("cannot arm supervisor process monitor");
    if (queue >= 0)
      close(queue);
    return EXIT_SETUP;
  }

  process_identity verified_owner;
  if (read_identity(owner.pid, &verified_owner, NULL) != 0 ||
      !same_identity(&owner, &verified_owner)) {
    close(queue);
    return EXIT_SETUP;
  }

  pid_t child_pid = fork();
  if (child_pid < 0) {
    report_error("cannot launch controlled process");
    close(queue);
    return EXIT_SETUP;
  }
  if (child_pid == 0) {
    (void)signal(SIGINT, SIG_DFL);
    (void)signal(SIGTERM, SIG_DFL);
    (void)signal(SIGHUP, SIG_DFL);
    (void)setpgid(0, 0);
    execvp(command[0], command);
    report_error("cannot execute controlled process");
    _exit(127);
  }
  (void)setpgid(child_pid, child_pid);

  process_identity child;
  pid_t child_parent = 0;
  if (read_identity(child_pid, &child, &child_parent) != 0) {
    kill_unreaped_child_group(child_pid);
    (void)wait_for_child(child_pid);
    close(queue);
    return EXIT_SETUP;
  }
  if (child_parent != getpid() || register_process(queue, &child, 2) != 0) {
    kill_unreaped_child_group(child_pid);
    (void)wait_for_child(child_pid);
    close(queue);
    return EXIT_SETUP;
  }

  long long force_deadline = -1;
  for (;;) {
    struct timespec timeout;
    struct timespec *timeout_pointer = NULL;
    if (force_deadline >= 0) {
      long long remaining = force_deadline - monotonic_milliseconds();
      if (remaining <= 0) {
        kill_unreaped_child_group(child_pid);
        int code = wait_for_child(child_pid);
        close(queue);
        return code;
      }
      timeout.tv_sec = (time_t)(remaining / 1000);
      timeout.tv_nsec = (long)((remaining % 1000) * 1000000);
      timeout_pointer = &timeout;
    }

    struct kevent events[8];
    int count = kevent(queue, NULL, 0, events, 8, timeout_pointer);
    if (count == 0 && force_deadline >= 0)
      continue;
    if (count < 0) {
      if (errno == EINTR)
        continue;
      kill_unreaped_child_group(child_pid);
      int code = wait_for_child(child_pid);
      close(queue);
      return code;
    }

    for (int index = 0; index < count; index += 1) {
      intptr_t tag = (intptr_t)events[index].udata;
      if (tag == 1) {
        kill_unreaped_child_group(child_pid);
        (void)wait_for_child(child_pid);
        close(queue);
        return 0;
      }
      if (tag == 2) {
        /*
         * The controlled root can exit before descendants that inherited its
         * process group.  Reap the complete group while the root is still our
         * unreaped child, so a controller crash cannot orphan Electron.
         */
        kill_unreaped_child_group(child_pid);
        int code = wait_for_child(child_pid);
        close(queue);
        return code;
      }
      if (tag == 3) {
        int signal_number = (int)events[index].ident;
        if (force_deadline >= 0) {
          kill_unreaped_child_group(child_pid);
        } else {
          (void)kill(child_pid, signal_number);
          long long now = monotonic_milliseconds();
          force_deadline = now < 0 ? 0 : now + FORCE_GRACE_MILLISECONDS;
        }
      }
    }
  }
}

#elif defined(__linux__)

static int run_watcher(pid_t owner_pid, pid_t controller_pid) {
  process_identity owner;
  process_identity controller;
  if (validate_relationship(owner_pid, controller_pid, &owner, &controller) !=
      0) {
    report_error("owner/controller relationship is no longer valid");
    return EXIT_SETUP;
  }

  int owner_descriptor = open_process_descriptor(owner_pid);
  int controller_descriptor = open_process_descriptor(controller_pid);
  if (owner_descriptor < 0 || controller_descriptor < 0) {
    report_error("pidfd process monitoring is unavailable");
    if (owner_descriptor >= 0)
      close(owner_descriptor);
    if (controller_descriptor >= 0)
      close(controller_descriptor);
    return EXIT_SETUP;
  }

  process_identity verified_owner;
  process_identity verified_controller;
  if (validate_relationship(owner_pid, controller_pid, &verified_owner,
                            &verified_controller) != 0 ||
      !same_identity(&owner, &verified_owner) ||
      !same_identity(&controller, &verified_controller)) {
    close(owner_descriptor);
    close(controller_descriptor);
    return EXIT_SETUP;
  }
  if (write_ready() != 0) {
    close(owner_descriptor);
    close(controller_descriptor);
    return EXIT_SETUP;
  }
  (void)close(STDOUT_FILENO);

  control_state state;
  memset(&state, 0, sizeof(state));
  int tracked_descriptor = -1;
  for (;;) {
    struct pollfd descriptors[4];
    descriptors[0] = (struct pollfd){owner_descriptor, POLLIN, 0};
    descriptors[1] = (struct pollfd){controller_descriptor, POLLIN, 0};
    descriptors[2] = (struct pollfd){STDIN_FILENO, POLLIN | POLLHUP, 0};
    descriptors[3] = (struct pollfd){tracked_descriptor, POLLIN, 0};
    int count = poll(descriptors, tracked_descriptor >= 0 ? 4 : 3, -1);
    if (count < 0) {
      if (errno == EINTR)
        continue;
      kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
      kill_identity(&controller, 0);
      break;
    }
    if (tracked_descriptor >= 0 && descriptors[3].revents != 0) {
      if (state.has_tracked)
        (void)kill(-state.tracked.pid, SIGKILL);
      close(tracked_descriptor);
      tracked_descriptor = -1;
      state.has_tracked = 0;
    }
    if (descriptors[0].revents != 0 || descriptors[1].revents != 0) {
      kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
      if (descriptors[0].revents != 0)
        kill_identity(&controller, 0);
      break;
    }
    if (descriptors[2].revents != 0) {
      int control =
          consume_control(&state, controller_pid, &tracked_descriptor);
      if (control == 0)
        continue;
      if (control == 1) {
        kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
      } else {
        kill_identity(state.has_tracked ? &state.tracked : NULL, 1);
        kill_identity(&controller, 0);
      }
      break;
    }
  }
  if (tracked_descriptor >= 0)
    close(tracked_descriptor);
  close(owner_descriptor);
  close(controller_descriptor);
  return 0;
}

static int walk_owner(int depth, process_identity *owner) {
  process_identity current;
  pid_t parent = 0;
  if (read_identity(getpid(), &current, &parent) != 0) {
    errno = ESRCH;
    return -1;
  }
  for (int level = 0; level < depth; level += 1) {
    if (parent <= 1) {
      errno = ESRCH;
      return -1;
    }
    process_identity next;
    pid_t next_parent = 0;
    if (read_identity(parent, &next, &next_parent) != 0 ||
        identity_started_after(&next, &current)) {
      errno = ESRCH;
      return -1;
    }
    process_identity verified;
    pid_t verified_parent = 0;
    if (read_identity(current.pid, &verified, &verified_parent) != 0 ||
        !same_identity(&current, &verified) || verified_parent != parent) {
      errno = ESRCH;
      return -1;
    }
    current = next;
    parent = next_parent;
  }
  *owner = current;
  return 0;
}

static long long monotonic_milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0)
    return -1;
  return (long long)now.tv_sec * 1000LL + now.tv_nsec / 1000000LL;
}

static int child_status_code(int status) {
  if (WIFEXITED(status))
    return WEXITSTATUS(status);
  if (WIFSIGNALED(status))
    return 128 + WTERMSIG(status);
  return EXIT_SETUP;
}

static int wait_for_child(pid_t child_pid) {
  int status = 0;
  for (;;) {
    pid_t result = waitpid(child_pid, &status, 0);
    if (result == child_pid)
      return child_status_code(status);
    if (result < 0 && errno == EINTR)
      continue;
    return EXIT_SETUP;
  }
}

static int run_supervisor(int owner_depth, char **command) {
  process_identity owner;
  if (walk_owner(owner_depth, &owner) != 0) {
    report_error("cannot resolve controlling owner process");
    return EXIT_SETUP;
  }
  int owner_descriptor = open_process_descriptor(owner.pid);
  if (owner_descriptor < 0) {
    report_error("pidfd process monitoring is unavailable");
    return EXIT_SETUP;
  }
  process_identity verified_owner;
  if (read_identity(owner.pid, &verified_owner, NULL) != 0 ||
      !same_identity(&owner, &verified_owner)) {
    close(owner_descriptor);
    return EXIT_SETUP;
  }

  sigset_t signal_mask;
  sigemptyset(&signal_mask);
  sigaddset(&signal_mask, SIGINT);
  sigaddset(&signal_mask, SIGTERM);
  sigaddset(&signal_mask, SIGHUP);
  if (sigprocmask(SIG_BLOCK, &signal_mask, NULL) != 0) {
    close(owner_descriptor);
    return EXIT_SETUP;
  }
  int signal_descriptor =
      signalfd(-1, &signal_mask, SFD_CLOEXEC | SFD_NONBLOCK);
  if (signal_descriptor < 0) {
    close(owner_descriptor);
    return EXIT_SETUP;
  }

  pid_t child_pid = fork();
  if (child_pid < 0) {
    close(owner_descriptor);
    close(signal_descriptor);
    return EXIT_SETUP;
  }
  if (child_pid == 0) {
    (void)sigprocmask(SIG_UNBLOCK, &signal_mask, NULL);
    (void)setpgid(0, 0);
    execvp(command[0], command);
    _exit(127);
  }
  (void)setpgid(child_pid, child_pid);
  process_identity child;
  pid_t child_parent = 0;
  if (read_identity(child_pid, &child, &child_parent) != 0 ||
      child_parent != getpid()) {
    kill_unreaped_child_group(child_pid);
    (void)wait_for_child(child_pid);
    close(owner_descriptor);
    close(signal_descriptor);
    return EXIT_SETUP;
  }
  int child_descriptor = open_process_descriptor(child_pid);
  if (child_descriptor < 0) {
    kill_unreaped_child_group(child_pid);
    (void)wait_for_child(child_pid);
    close(owner_descriptor);
    close(signal_descriptor);
    return EXIT_SETUP;
  }
  process_identity verified_child;
  pid_t verified_parent = 0;
  if (read_identity(child_pid, &verified_child, &verified_parent) != 0 ||
      verified_parent != getpid() || !same_identity(&child, &verified_child)) {
    kill_unreaped_child_group(child_pid);
    (void)wait_for_child(child_pid);
    close(owner_descriptor);
    close(child_descriptor);
    close(signal_descriptor);
    return EXIT_SETUP;
  }

  long long force_deadline = -1;
  for (;;) {
    int timeout = -1;
    if (force_deadline >= 0) {
      long long remaining = force_deadline - monotonic_milliseconds();
      if (remaining <= 0) {
        kill_unreaped_child_group(child_pid);
        int code = wait_for_child(child_pid);
        close(owner_descriptor);
        close(child_descriptor);
        close(signal_descriptor);
        return code;
      }
      timeout = remaining > INT32_MAX ? INT32_MAX : (int)remaining;
    }
    struct pollfd descriptors[3] = {
        {owner_descriptor, POLLIN, 0},
        {child_descriptor, POLLIN, 0},
        {signal_descriptor, POLLIN, 0},
    };
    int count = poll(descriptors, 3, timeout);
    if (count < 0) {
      if (errno == EINTR)
        continue;
      kill_unreaped_child_group(child_pid);
      int code = wait_for_child(child_pid);
      close(owner_descriptor);
      close(child_descriptor);
      close(signal_descriptor);
      return code;
    }
    if (descriptors[0].revents != 0) {
      kill_unreaped_child_group(child_pid);
      (void)wait_for_child(child_pid);
      close(owner_descriptor);
      close(child_descriptor);
      close(signal_descriptor);
      return 0;
    }
    if (descriptors[1].revents != 0) {
      /* See the macOS path above: pidfd readiness precedes waitpid(), which
       * keeps the exact root identity available while its group is reaped. */
      kill_unreaped_child_group(child_pid);
      int code = wait_for_child(child_pid);
      close(owner_descriptor);
      close(child_descriptor);
      close(signal_descriptor);
      return code;
    }
    if (descriptors[2].revents != 0) {
      struct signalfd_siginfo info;
      if (read(signal_descriptor, &info, sizeof(info)) == sizeof(info)) {
        if (force_deadline >= 0) {
          kill_unreaped_child_group(child_pid);
        } else {
          (void)kill(child_pid, (int)info.ssi_signo);
          long long now = monotonic_milliseconds();
          force_deadline = now < 0 ? 0 : now + FORCE_GRACE_MILLISECONDS;
        }
      }
    }
  }
}

#endif

static void usage(void) {
  static const char text[] =
      "usage: translator-owner-supervisor --watch OWNER_PID CONTROLLER_PID\n"
      "   or: translator-owner-supervisor --supervise OWNER_DEPTH -- COMMAND "
      "[ARGS...]\n";
  (void)write(STDERR_FILENO, text, sizeof(text) - 1);
}

int main(int argc, char **argv) {
  (void)signal(SIGPIPE, SIG_IGN);
  if (argc == 4 && strcmp(argv[1], "--watch") == 0) {
    pid_t owner_pid = 0;
    pid_t controller_pid = 0;
    if (parse_positive_pid(argv[2], &owner_pid) != 0 ||
        parse_positive_pid(argv[3], &controller_pid) != 0) {
      usage();
      return EXIT_USAGE;
    }
    return run_watcher(owner_pid, controller_pid);
  }
  if (argc >= 5 && strcmp(argv[1], "--supervise") == 0 &&
      strcmp(argv[3], "--") == 0) {
    int owner_depth = 0;
    if (parse_positive_int(argv[2], &owner_depth) != 0) {
      usage();
      return EXIT_USAGE;
    }
    return run_supervisor(owner_depth, &argv[4]);
  }
  usage();
  return EXIT_USAGE;
}
