#!/usr/bin/env bash
set -euo pipefail

repo_root=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)
source_path="$repo_root/packages/agent-server/native/translator-owner-supervisor.c"
output_path="$repo_root/packages/agent-server/bin/translator-owner-supervisor"

mkdir -p "$(dirname "$output_path")"
xcrun clang \
  -std=c11 \
  -O2 \
  -Wall \
  -Wextra \
  -Werror \
  -mmacosx-version-min=11.0 \
  -arch arm64 \
  -arch x86_64 \
  "$source_path" \
  -lproc \
  -o "$output_path"
chmod 0755 "$output_path"
