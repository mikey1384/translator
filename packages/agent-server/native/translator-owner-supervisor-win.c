#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

// clang-format off: tlhelp32.h requires the Windows base types first.
#include <windows.h>
#include <tlhelp32.h>
// clang-format on

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define EXIT_USAGE 64
#define EXIT_SETUP 70
#define MAX_CONTROL_BUFFER 512

typedef struct {
  DWORD pid;
  FILETIME created;
} process_identity;

typedef struct {
  DWORD pid;
  DWORD parent_pid;
  process_identity identity;
  BOOL descendant;
} tree_process;

typedef struct {
  CRITICAL_SECTION lock;
  HANDLE changed;
  HANDLE transition_applied;
  HANDLE input;
  DWORD controller_pid;
  process_identity tracked;
  HANDLE tracked_handle;
  BOOL has_tracked;
  BOOL retire_tracked;
  BOOL closing;
  BOOL failed;
} watcher_control;

static PVOID volatile active_job = NULL;
static LONG volatile console_shutdown_requested = 0;

static void report_windows_error(const wchar_t *message) {
  DWORD code = GetLastError();
  wchar_t system_message[256];
  DWORD length = FormatMessageW(
      FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, code, 0,
      system_message, (DWORD)(sizeof(system_message) / sizeof(wchar_t)), NULL);
  if (length == 0) {
    (void)swprintf(system_message, sizeof(system_message) / sizeof(wchar_t),
                   L"error %lu", (unsigned long)code);
  }
  wchar_t output[768];
  int output_length = swprintf(output, sizeof(output) / sizeof(wchar_t),
                               L"translator-owner-supervisor: %ls: %ls\r\n",
                               message, system_message);
  if (output_length <= 0)
    return;

  HANDLE error_output = GetStdHandle(STD_ERROR_HANDLE);
  if (error_output == NULL || error_output == INVALID_HANDLE_VALUE)
    return;
  int utf8_length = WideCharToMultiByte(CP_UTF8, 0, output, output_length, NULL,
                                        0, NULL, NULL);
  if (utf8_length <= 0)
    return;
  char utf8[2304];
  if ((size_t)utf8_length > sizeof(utf8))
    return;
  (void)WideCharToMultiByte(CP_UTF8, 0, output, output_length, utf8,
                            utf8_length, NULL, NULL);
  DWORD written = 0;
  (void)WriteFile(error_output, utf8, (DWORD)utf8_length, &written, NULL);
}

static int parse_positive_dword(const wchar_t *value, DWORD *result) {
  wchar_t *end = NULL;
  errno = 0;
  unsigned long parsed = wcstoul(value, &end, 10);
  if (errno != 0 || end == value || *end != L'\0' || parsed <= 1) {
    return -1;
  }
  *result = (DWORD)parsed;
  return 0;
}

static int parse_positive_int(const wchar_t *value, int *result) {
  wchar_t *end = NULL;
  errno = 0;
  long parsed = wcstol(value, &end, 10);
  if (errno != 0 || end == value || *end != L'\0' || parsed <= 0 || parsed > 64)
    return -1;
  *result = (int)parsed;
  return 0;
}

static int compare_file_time(const FILETIME *left, const FILETIME *right) {
  ULARGE_INTEGER left_value;
  ULARGE_INTEGER right_value;
  left_value.LowPart = left->dwLowDateTime;
  left_value.HighPart = left->dwHighDateTime;
  right_value.LowPart = right->dwLowDateTime;
  right_value.HighPart = right->dwHighDateTime;
  if (left_value.QuadPart < right_value.QuadPart)
    return -1;
  if (left_value.QuadPart > right_value.QuadPart)
    return 1;
  return 0;
}

static BOOL same_identity(const process_identity *left,
                          const process_identity *right) {
  return left->pid == right->pid &&
         compare_file_time(&left->created, &right->created) == 0;
}

static DWORD find_parent_pid(DWORD pid) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE)
    return 0;
  PROCESSENTRY32W entry;
  ZeroMemory(&entry, sizeof(entry));
  entry.dwSize = sizeof(entry);
  DWORD parent = 0;
  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == pid) {
        parent = entry.th32ParentProcessID;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  return parent;
}

static HANDLE open_identity(DWORD pid, DWORD access,
                            process_identity *identity) {
  HANDLE process = OpenProcess(
      access | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (process == NULL)
    return NULL;
  FILETIME exited;
  FILETIME kernel;
  FILETIME user;
  if (!GetProcessTimes(process, &identity->created, &exited, &kernel, &user)) {
    CloseHandle(process);
    return NULL;
  }
  identity->pid = pid;
  return process;
}

static BOOL identity_is_live(const process_identity *expected,
                             DWORD desired_access, HANDLE *opened) {
  process_identity current;
  HANDLE process = open_identity(expected->pid, desired_access, &current);
  if (process == NULL)
    return FALSE;
  if (compare_file_time(&expected->created, &current.created) != 0) {
    CloseHandle(process);
    return FALSE;
  }
  if (opened != NULL) {
    *opened = process;
  } else {
    CloseHandle(process);
  }
  return TRUE;
}

static BOOL validate_relationship(DWORD owner_pid, DWORD controller_pid,
                                  process_identity *owner,
                                  process_identity *controller,
                                  HANDLE *owner_handle,
                                  HANDLE *controller_handle) {
  HANDLE opened_controller =
      open_identity(controller_pid, PROCESS_TERMINATE, controller);
  if (opened_controller == NULL)
    return FALSE;
  HANDLE opened_owner = open_identity(owner_pid, 0, owner);
  if (opened_owner == NULL || find_parent_pid(controller_pid) != owner_pid ||
      compare_file_time(&owner->created, &controller->created) > 0) {
    if (opened_owner != NULL)
      CloseHandle(opened_owner);
    CloseHandle(opened_controller);
    SetLastError(ERROR_INVALID_PARAMETER);
    return FALSE;
  }
  *owner_handle = opened_owner;
  *controller_handle = opened_controller;
  return TRUE;
}

static void terminate_identity(const process_identity *identity) {
  HANDLE process = NULL;
  if (!identity_is_live(identity, PROCESS_TERMINATE, &process))
    return;
  (void)TerminateProcess(process, 1);
  CloseHandle(process);
}

static tree_process *snapshot_process_tree(const process_identity *root,
                                           BOOL root_identity_pinned,
                                           size_t *count_out) {
  *count_out = 0;
  FILETIME snapshot_started;
  GetSystemTimeAsFileTime(&snapshot_started);
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE)
    return NULL;
  size_t capacity = 256;
  tree_process *entries =
      (tree_process *)calloc(capacity, sizeof(tree_process));
  if (entries == NULL) {
    CloseHandle(snapshot);
    SetLastError(ERROR_OUTOFMEMORY);
    return NULL;
  }
  PROCESSENTRY32W entry;
  ZeroMemory(&entry, sizeof(entry));
  entry.dwSize = sizeof(entry);
  size_t count = 0;
  BOOL exact_root_present = FALSE;
  BOOL reused_root_pid_present = FALSE;
  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (count == capacity) {
        if (capacity > SIZE_MAX / 2 ||
            capacity * 2 > SIZE_MAX / sizeof(tree_process)) {
          free(entries);
          CloseHandle(snapshot);
          SetLastError(ERROR_ARITHMETIC_OVERFLOW);
          return NULL;
        }
        capacity *= 2;
        tree_process *expanded =
            (tree_process *)realloc(entries, capacity * sizeof(tree_process));
        if (expanded == NULL) {
          free(entries);
          CloseHandle(snapshot);
          SetLastError(ERROR_OUTOFMEMORY);
          return NULL;
        }
        entries = expanded;
      }
      process_identity identity;
      HANDLE process = open_identity(entry.th32ProcessID, 0, &identity);
      if (process == NULL)
        continue;
      CloseHandle(process);
      /* A PID opened as a process created after the snapshot began was reused
       * after Toolhelp recorded it; never attach that new identity to the old
       * snapshot's parent relationship. */
      if (compare_file_time(&identity.created, &snapshot_started) > 0)
        continue;
      entries[count].pid = entry.th32ProcessID;
      entries[count].parent_pid = entry.th32ParentProcessID;
      entries[count].identity = identity;
      entries[count].descendant =
          entry.th32ProcessID == root->pid && same_identity(&identity, root);
      if (entry.th32ProcessID == root->pid) {
        if (entries[count].descendant)
          exact_root_present = TRUE;
        else
          reused_root_pid_present = TRUE;
      }
      count += 1;
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);

  /* A signaled process disappears from Toolhelp before its retained process
   * handle is closed. While that exact handle pins the PID against reuse, seed
   * its direct children so they remain reapable after the root exits first. */
  if (root_identity_pinned && !exact_root_present && !reused_root_pid_present) {
    for (size_t index = 0; index < count; index += 1) {
      if (entries[index].parent_pid == root->pid &&
          compare_file_time(&entries[index].identity.created,
                            &root->created) >= 0) {
        entries[index].descendant = TRUE;
      }
    }
  }

  BOOL changed = TRUE;
  while (changed) {
    changed = FALSE;
    for (size_t index = 0; index < count; index += 1) {
      if (entries[index].descendant)
        continue;
      for (size_t parent = 0; parent < count; parent += 1) {
        if (entries[parent].descendant &&
            entries[index].parent_pid == entries[parent].pid &&
            compare_file_time(&entries[index].identity.created,
                              &entries[parent].identity.created) >= 0) {
          entries[index].descendant = TRUE;
          changed = TRUE;
          break;
        }
      }
    }
  }
  *count_out = count;
  return entries;
}

static void terminate_process_tree_internal(const process_identity *root,
                                            BOOL root_identity_pinned) {
  size_t count = 0;
  tree_process *entries =
      snapshot_process_tree(root, root_identity_pinned, &count);
  for (size_t index = count; index > 0; index -= 1) {
    tree_process *entry = &entries[index - 1];
    if (!entry->descendant || entry->pid == root->pid)
      continue;
    terminate_identity(&entry->identity);
  }
  free(entries);
  terminate_identity(root);
}

static void terminate_pinned_process_tree(const process_identity *root,
                                          HANDLE root_handle) {
  /* Stop the exact pinned root before taking the descendant snapshot. A live
   * Electron root could otherwise create another child after the snapshot and
   * before its own termination, escaping the captured tree. The retained
   * process handle pins both identity and PID until the follow-up walk ends. */
  if (root_handle != NULL &&
      WaitForSingleObject(root_handle, 0) != WAIT_OBJECT_0 &&
      TerminateProcess(root_handle, 1)) {
    (void)WaitForSingleObject(root_handle, INFINITE);
  }
  terminate_process_tree_internal(root, TRUE);
}

static BOOL write_ready(void) {
  static const char ready[] = "READY\n";
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  if (output == NULL || output == INVALID_HANDLE_VALUE)
    return FALSE;
  DWORD written = 0;
  BOOL result =
      WriteFile(output, ready, (DWORD)(sizeof(ready) - 1), &written, NULL);
  if (result)
    (void)CloseHandle(output);
  return result && written == (DWORD)(sizeof(ready) - 1);
}

static BOOL parse_control_line(watcher_control *control, const char *line) {
  if (strcmp(line, "CLOSING") == 0) {
    EnterCriticalSection(&control->lock);
    control->closing = TRUE;
    LeaveCriticalSection(&control->lock);
    SetEvent(control->changed);
    return TRUE;
  }

  char action[16];
  unsigned long raw_pid = 0;
  char trailing = '\0';
  if (sscanf_s(line, "%15s %lu %c", action, (unsigned)_countof(action),
               &raw_pid, &trailing, 1) != 2 ||
      raw_pid <= 1) {
    return FALSE;
  }
  DWORD pid = (DWORD)raw_pid;
  if (strcmp(action, "UNTRACK") == 0) {
    BOOL must_wait = FALSE;
    EnterCriticalSection(&control->lock);
    if (control->has_tracked && control->tracked.pid == pid) {
      control->retire_tracked = TRUE;
      must_wait = TRUE;
    }
    LeaveCriticalSection(&control->lock);
    SetEvent(control->changed);
    /* The waiter owns the pinned process handle and is the only thread that
     * may remove it from a WaitForMultipleObjects set. Do not parse a
     * following TRACK command until that exact retirement is complete; a
     * fast Electron relaunch can put UNTRACK and TRACK in the same pipe read. */
    if (must_wait &&
        WaitForSingleObject(control->transition_applied, INFINITE) !=
            WAIT_OBJECT_0) {
      return FALSE;
    }
    return TRUE;
  }
  if (strcmp(action, "TRACK") != 0 ||
      find_parent_pid(pid) != control->controller_pid) {
    return FALSE;
  }

  process_identity tracked;
  HANDLE tracked_handle = open_identity(pid, PROCESS_TERMINATE, &tracked);
  if (tracked_handle == NULL)
    return FALSE;
  process_identity verified;
  HANDLE verified_handle = open_identity(pid, 0, &verified);
  DWORD verified_parent = find_parent_pid(pid);
  if (verified_handle == NULL || verified_parent != control->controller_pid ||
      !same_identity(&tracked, &verified)) {
    if (verified_handle != NULL)
      CloseHandle(verified_handle);
    CloseHandle(tracked_handle);
    return FALSE;
  }
  CloseHandle(verified_handle);
  EnterCriticalSection(&control->lock);
  if (control->closing || control->failed || control->retire_tracked ||
      (control->has_tracked &&
       !same_identity(&control->tracked, &tracked))) {
    LeaveCriticalSection(&control->lock);
    CloseHandle(tracked_handle);
    return FALSE;
  }
  if (control->has_tracked) {
    CloseHandle(tracked_handle);
  } else {
    control->tracked = tracked;
    control->tracked_handle = tracked_handle;
    control->has_tracked = TRUE;
  }
  LeaveCriticalSection(&control->lock);
  SetEvent(control->changed);
  return TRUE;
}

static DWORD WINAPI read_control(LPVOID parameter) {
  watcher_control *control = (watcher_control *)parameter;
  char buffer[MAX_CONTROL_BUFFER];
  size_t length = 0;
  for (;;) {
    DWORD read_count = 0;
    BOOL result = ReadFile(control->input, buffer + length,
                           (DWORD)(sizeof(buffer) - length), &read_count, NULL);
    if (!result || read_count == 0)
      break;
    length += read_count;
    size_t consumed = 0;
    for (size_t index = 0; index < length; index += 1) {
      if (buffer[index] != '\n')
        continue;
      buffer[index] = '\0';
      if (!parse_control_line(control, buffer + consumed)) {
        EnterCriticalSection(&control->lock);
        control->failed = TRUE;
        LeaveCriticalSection(&control->lock);
        SetEvent(control->changed);
        return 0;
      }
      consumed = index + 1;
    }
    if (consumed > 0) {
      memmove(buffer, buffer + consumed, length - consumed);
      length -= consumed;
    }
    if (length == sizeof(buffer)) {
      EnterCriticalSection(&control->lock);
      control->failed = TRUE;
      LeaveCriticalSection(&control->lock);
      SetEvent(control->changed);
      return 0;
    }
    EnterCriticalSection(&control->lock);
    BOOL closing = control->closing;
    LeaveCriticalSection(&control->lock);
    if (closing)
      break;
  }
  EnterCriticalSection(&control->lock);
  if (!control->closing)
    control->failed = TRUE;
  LeaveCriticalSection(&control->lock);
  SetEvent(control->changed);
  return 0;
}

static int run_watcher(DWORD owner_pid, DWORD controller_pid) {
  process_identity owner;
  process_identity controller;
  HANDLE owner_handle = NULL;
  HANDLE controller_handle = NULL;
  if (!validate_relationship(owner_pid, controller_pid, &owner, &controller,
                             &owner_handle, &controller_handle)) {
    report_windows_error(L"owner/controller relationship is no longer valid");
    return EXIT_SETUP;
  }

  watcher_control control;
  ZeroMemory(&control, sizeof(control));
  InitializeCriticalSection(&control.lock);
  control.input = GetStdHandle(STD_INPUT_HANDLE);
  control.controller_pid = controller_pid;
  control.changed = CreateEventW(NULL, TRUE, FALSE, NULL);
  control.transition_applied = CreateEventW(NULL, FALSE, FALSE, NULL);
  if (control.input == NULL || control.input == INVALID_HANDLE_VALUE ||
      control.changed == NULL || control.transition_applied == NULL ||
      !write_ready()) {
    report_windows_error(L"cannot arm ownership control channel");
    if (control.changed != NULL)
      CloseHandle(control.changed);
    if (control.transition_applied != NULL)
      CloseHandle(control.transition_applied);
    CloseHandle(owner_handle);
    CloseHandle(controller_handle);
    DeleteCriticalSection(&control.lock);
    return EXIT_SETUP;
  }

  HANDLE reader = CreateThread(NULL, 0, read_control, &control, 0, NULL);
  if (reader == NULL) {
    report_windows_error(L"cannot start ownership control reader");
    CloseHandle(control.transition_applied);
    CloseHandle(control.changed);
    CloseHandle(owner_handle);
    CloseHandle(controller_handle);
    DeleteCriticalSection(&control.lock);
    return EXIT_SETUP;
  }

  DWORD wait_result = WAIT_FAILED;
  BOOL closing = FALSE;
  BOOL failed = FALSE;
  for (;;) {
    HANDLE handles[4] = {owner_handle, controller_handle, control.changed,
                         NULL};
    DWORD handle_count = 3;
    EnterCriticalSection(&control.lock);
    if (control.has_tracked) {
      handles[3] = control.tracked_handle;
      handle_count = 4;
    }
    LeaveCriticalSection(&control.lock);

    wait_result =
        WaitForMultipleObjects(handle_count, handles, FALSE, INFINITE);
    if (wait_result == WAIT_FAILED || wait_result == WAIT_OBJECT_0 ||
        wait_result == WAIT_OBJECT_0 + 1) {
      break;
    }

    if (wait_result == WAIT_OBJECT_0 + 3 && handle_count == 4) {
      process_identity exited;
      HANDLE exited_handle = NULL;
      BOOL retirement_applied = FALSE;
      EnterCriticalSection(&control.lock);
      if (control.has_tracked &&
          control.tracked_handle == handles[3]) {
        exited = control.tracked;
        exited_handle = control.tracked_handle;
        control.tracked_handle = NULL;
        control.has_tracked = FALSE;
        retirement_applied = control.retire_tracked;
        control.retire_tracked = FALSE;
      }
      LeaveCriticalSection(&control.lock);
      if (exited_handle != NULL) {
        terminate_pinned_process_tree(&exited, exited_handle);
        CloseHandle(exited_handle);
      }
      /* UNTRACK may have begun just after this signaled handle won the wait.
       * In that ordering the reader is already serialized behind the exact
       * retirement, so acknowledge it even though the process exited first. */
      if (retirement_applied)
        SetEvent(control.transition_applied);
      continue;
    }

    if (wait_result == WAIT_OBJECT_0 + 2) {
      process_identity retired;
      HANDLE retired_handle = NULL;
      EnterCriticalSection(&control.lock);
      ResetEvent(control.changed);
      closing = control.closing;
      failed = control.failed;
      if ((control.retire_tracked || closing || failed) &&
          control.has_tracked) {
        retired = control.tracked;
        retired_handle = control.tracked_handle;
        control.tracked_handle = NULL;
        control.has_tracked = FALSE;
      }
      control.retire_tracked = FALSE;
      LeaveCriticalSection(&control.lock);
      if (retired_handle != NULL) {
        terminate_pinned_process_tree(&retired, retired_handle);
        CloseHandle(retired_handle);
        SetEvent(control.transition_applied);
      }
      if (closing || failed)
        break;
      continue;
    }

    wait_result = WAIT_FAILED;
    break;
  }

  process_identity tracked;
  HANDLE tracked_handle = NULL;
  EnterCriticalSection(&control.lock);
  control.closing = TRUE;
  closing = control.closing && !control.failed;
  failed = control.failed;
  if (control.has_tracked) {
    tracked = control.tracked;
    tracked_handle = control.tracked_handle;
    control.tracked_handle = NULL;
    control.has_tracked = FALSE;
  }
  LeaveCriticalSection(&control.lock);

  /* Release a reader serialized behind UNTRACK even when owner/controller
   * loss wins the wait before the normal transition branch can acknowledge
   * it. */
  SetEvent(control.transition_applied);

  if (tracked_handle != NULL) {
    terminate_pinned_process_tree(&tracked, tracked_handle);
    CloseHandle(tracked_handle);
  }
  if (wait_result == WAIT_OBJECT_0 || wait_result == WAIT_FAILED ||
      (wait_result == WAIT_OBJECT_0 + 2 && (!closing || failed))) {
    terminate_identity(&controller);
  }

  CancelSynchronousIo(reader);
  (void)WaitForSingleObject(reader, INFINITE);
  CloseHandle(reader);
  CloseHandle(control.transition_applied);
  CloseHandle(control.changed);
  CloseHandle(owner_handle);
  CloseHandle(controller_handle);
  DeleteCriticalSection(&control.lock);
  return wait_result == WAIT_FAILED ? EXIT_SETUP : 0;
}

static BOOL duplicate_standard_handle(DWORD kind, HANDLE *duplicate) {
  HANDLE source = GetStdHandle(kind);
  if (source == NULL || source == INVALID_HANDLE_VALUE) {
    *duplicate = source;
    return TRUE;
  }
  return DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(),
                         duplicate, 0, TRUE, DUPLICATE_SAME_ACCESS);
}

static size_t quoted_argument_length(const wchar_t *argument) {
  size_t length = wcslen(argument);
  return length * 2 + 3;
}

static wchar_t *append_quoted_argument(wchar_t *output,
                                       const wchar_t *argument) {
  BOOL quote = *argument == L'\0' || wcspbrk(argument, L" \t\n\v\"") != NULL;
  if (!quote) {
    while (*argument != L'\0')
      *output++ = *argument++;
    return output;
  }

  *output++ = L'"';
  size_t backslashes = 0;
  for (;;) {
    wchar_t character = *argument++;
    if (character == L'\\') {
      backslashes += 1;
      continue;
    }
    if (character == L'"') {
      for (size_t index = 0; index < backslashes * 2 + 1; index += 1) {
        *output++ = L'\\';
      }
      *output++ = L'"';
      backslashes = 0;
      continue;
    }
    if (character == L'\0') {
      for (size_t index = 0; index < backslashes * 2; index += 1) {
        *output++ = L'\\';
      }
      *output++ = L'"';
      return output;
    }
    for (size_t index = 0; index < backslashes; index += 1) {
      *output++ = L'\\';
    }
    backslashes = 0;
    *output++ = character;
  }
}

static wchar_t *build_command_line(int count, wchar_t **arguments) {
  size_t capacity = 1;
  for (int index = 0; index < count; index += 1) {
    capacity += quoted_argument_length(arguments[index]) + 1;
  }
  wchar_t *command_line = (wchar_t *)calloc(capacity, sizeof(wchar_t));
  if (command_line == NULL)
    return NULL;
  wchar_t *output = command_line;
  for (int index = 0; index < count; index += 1) {
    if (index > 0)
      *output++ = L' ';
    output = append_quoted_argument(output, arguments[index]);
  }
  *output = L'\0';
  return command_line;
}

static BOOL WINAPI handle_console_event(DWORD event) {
  (void)event;
  (void)InterlockedExchange(&console_shutdown_requested, 1);
  HANDLE job = (HANDLE)InterlockedExchangePointer(&active_job, NULL);
  if (job != NULL) {
    (void)TerminateJobObject(job, 1);
    CloseHandle(job);
  }
  return TRUE;
}

static void release_active_job(HANDLE job) {
  PVOID owned = InterlockedCompareExchangePointer(&active_job, NULL, job);
  if (owned == job)
    CloseHandle(job);
}

static int run_supervisor(int owner_depth, int command_count,
                          wchar_t **command) {
  process_identity current;
  HANDLE current_handle =
      open_identity(GetCurrentProcessId(), 0, &current);
  if (current_handle == NULL) {
    report_windows_error(L"cannot open supervisor process identity");
    return EXIT_SETUP;
  }
  for (int level = 0; level < owner_depth; level += 1) {
    DWORD parent_pid = find_parent_pid(current.pid);
    if (parent_pid <= 1) {
      SetLastError(ERROR_INVALID_PARAMETER);
      report_windows_error(L"cannot resolve controlling owner process");
      CloseHandle(current_handle);
      return EXIT_SETUP;
    }
    process_identity parent;
    HANDLE parent_handle = open_identity(parent_pid, 0, &parent);
    if (parent_handle == NULL ||
        compare_file_time(&parent.created, &current.created) > 0) {
      SetLastError(ERROR_INVALID_PARAMETER);
      report_windows_error(L"cannot resolve exact controlling owner process");
      if (parent_handle != NULL)
        CloseHandle(parent_handle);
      CloseHandle(current_handle);
      return EXIT_SETUP;
    }
    CloseHandle(current_handle);
    current = parent;
    current_handle = parent_handle;
  }
  HANDLE owner_handle = current_handle;

  HANDLE job = CreateJobObjectW(NULL, NULL);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (job == NULL ||
      !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    report_windows_error(L"cannot create process containment job");
    if (job != NULL)
      CloseHandle(job);
    CloseHandle(owner_handle);
    return EXIT_SETUP;
  }
  (void)InterlockedExchangePointer(&active_job, job);
  (void)SetConsoleCtrlHandler(handle_console_event, TRUE);

  if (InterlockedCompareExchange(&console_shutdown_requested, 0, 0) != 0) {
    (void)SetConsoleCtrlHandler(handle_console_event, FALSE);
    release_active_job(job);
    CloseHandle(owner_handle);
    return 0;
  }

  wchar_t *command_line = build_command_line(command_count, command);
  if (command_line == NULL) {
    (void)SetConsoleCtrlHandler(handle_console_event, FALSE);
    release_active_job(job);
    CloseHandle(owner_handle);
    return EXIT_SETUP;
  }

  STARTUPINFOW startup;
  PROCESS_INFORMATION child;
  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&child, sizeof(child));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  if (!duplicate_standard_handle(STD_INPUT_HANDLE, &startup.hStdInput) ||
      !duplicate_standard_handle(STD_OUTPUT_HANDLE, &startup.hStdOutput) ||
      !duplicate_standard_handle(STD_ERROR_HANDLE, &startup.hStdError)) {
    report_windows_error(L"cannot duplicate controlled standard handles");
    if (startup.hStdInput != NULL && startup.hStdInput != INVALID_HANDLE_VALUE)
      CloseHandle(startup.hStdInput);
    if (startup.hStdOutput != NULL &&
        startup.hStdOutput != INVALID_HANDLE_VALUE)
      CloseHandle(startup.hStdOutput);
    if (startup.hStdError != NULL && startup.hStdError != INVALID_HANDLE_VALUE)
      CloseHandle(startup.hStdError);
    free(command_line);
    (void)SetConsoleCtrlHandler(handle_console_event, FALSE);
    release_active_job(job);
    CloseHandle(owner_handle);
    return EXIT_SETUP;
  }

  BOOL created = CreateProcessW(NULL, command_line, NULL, NULL, TRUE,
                                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT |
                                    CREATE_NEW_PROCESS_GROUP,
                                NULL, NULL, &startup, &child);
  if (startup.hStdInput != NULL && startup.hStdInput != INVALID_HANDLE_VALUE)
    CloseHandle(startup.hStdInput);
  if (startup.hStdOutput != NULL && startup.hStdOutput != INVALID_HANDLE_VALUE)
    CloseHandle(startup.hStdOutput);
  if (startup.hStdError != NULL && startup.hStdError != INVALID_HANDLE_VALUE)
    CloseHandle(startup.hStdError);
  free(command_line);
  if (!created || !AssignProcessToJobObject(job, child.hProcess) ||
      ResumeThread(child.hThread) == (DWORD)-1) {
    report_windows_error(L"cannot launch contained process");
    if (created) {
      (void)TerminateProcess(child.hProcess, 1);
      CloseHandle(child.hThread);
      CloseHandle(child.hProcess);
    }
    (void)SetConsoleCtrlHandler(handle_console_event, FALSE);
    release_active_job(job);
    CloseHandle(owner_handle);
    return EXIT_SETUP;
  }
  CloseHandle(child.hThread);

  HANDLE handles[2] = {owner_handle, child.hProcess};
  DWORD wait_result = WaitForMultipleObjects(2, handles, FALSE, INFINITE);
  DWORD child_code = 1;
  if (wait_result == WAIT_OBJECT_0) {
    (void)TerminateJobObject(job, 1);
    (void)WaitForSingleObject(child.hProcess, INFINITE);
    child_code = 0;
  } else if (wait_result == WAIT_OBJECT_0 + 1) {
    (void)GetExitCodeProcess(child.hProcess, &child_code);
  } else {
    (void)TerminateJobObject(job, 1);
  }

  (void)SetConsoleCtrlHandler(handle_console_event, FALSE);
  release_active_job(job);
  CloseHandle(owner_handle);
  CloseHandle(child.hProcess);
  return (int)child_code;
}

static void usage(void) {
  static const char text[] =
      "usage: translator-owner-supervisor --watch OWNER_PID CONTROLLER_PID\r\n"
      "   or: translator-owner-supervisor --supervise OWNER_DEPTH -- COMMAND "
      "[ARGS...]\r\n";
  HANDLE output = GetStdHandle(STD_ERROR_HANDLE);
  if (output == NULL || output == INVALID_HANDLE_VALUE)
    return;
  DWORD written = 0;
  (void)WriteFile(output, text, (DWORD)(sizeof(text) - 1), &written, NULL);
}

int wmain(int argc, wchar_t **argv) {
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX |
               SEM_NOOPENFILEERRORBOX);
  if (argc == 4 && wcscmp(argv[1], L"--watch") == 0) {
    DWORD owner_pid = 0;
    DWORD controller_pid = 0;
    if (parse_positive_dword(argv[2], &owner_pid) != 0 ||
        parse_positive_dword(argv[3], &controller_pid) != 0) {
      usage();
      return EXIT_USAGE;
    }
    return run_watcher(owner_pid, controller_pid);
  }
  if (argc >= 5 && wcscmp(argv[1], L"--supervise") == 0 &&
      wcscmp(argv[3], L"--") == 0) {
    int owner_depth = 0;
    if (parse_positive_int(argv[2], &owner_depth) != 0) {
      usage();
      return EXIT_USAGE;
    }
    return run_supervisor(owner_depth, argc - 4, &argv[4]);
  }
  usage();
  return EXIT_USAGE;
}
