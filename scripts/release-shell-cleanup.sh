#!/usr/bin/env bash

# Run an EXIT-trap cleanup command without allowing its status to hide the
# status that caused the shell to exit. Bash 3.2 reports status 0 to an EXIT
# trap for some fatal expansion errors, so callers also pass a completion
# sentinel that is set to true only after the release body reaches its end.
release_cleanup_and_exit() {
  if [ "$#" -lt 3 ]; then
    trap - EXIT
    printf '%s\n' 'release_cleanup_and_exit requires a status, completion sentinel, and cleanup command' >&2
    exit 64
  fi

  local original_status="$1"
  local completed="$2"
  local cleanup_status
  shift 2

  case "$original_status" in
    '' | *[!0-9]*)
      trap - EXIT
      printf 'invalid release exit status: %s\n' "$original_status" >&2
      exit 64
      ;;
  esac
  case "$completed" in
    true | false) ;;
    *)
      trap - EXIT
      printf 'invalid release completion sentinel: %s\n' "$completed" >&2
      exit 64
      ;;
  esac

  if [ "$completed" != "true" ] && [ "$original_status" -eq 0 ]; then
    original_status=1
  fi

  trap - EXIT
  set +e
  ("$@")
  cleanup_status=$?

  if [ "$original_status" -ne 0 ]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}
