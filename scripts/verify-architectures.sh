#!/usr/bin/env bash
set -euo pipefail

verify_macho_arch() {
  local path="$1"
  local expected_arch="$2"

  if [[ ! -f "$path" ]]; then
    echo "::error::Missing native runtime file: $path" >&2
    return 1
  fi

  if ! lipo "$path" -verify_arch "$expected_arch" 2>/dev/null; then
    echo "::error::Expected $expected_arch Mach-O, got: $(file "$path")" >&2
    return 1
  fi

  printf "  %-45s %s\n" "$(basename "$path")" "$(lipo -archs "$path")"
}

verify_app() {
  local app_path="$1"
  local expected_arch="$2"
  local runtime_arch="$3"
  local resources="$app_path/Contents/Resources/app.asar.unpacked/node_modules"
  local app_resources="$app_path/Contents/Resources"
  local onnx_dir="$resources/onnxruntime-node/bin/napi-v6/darwin/$runtime_arch"
  local headless_dir="$app_resources/headless-$runtime_arch"
  local other_runtime_arch
  local headless_binary

  if [[ "$runtime_arch" == "arm64" ]]; then
    other_runtime_arch="x64"
  else
    other_runtime_arch="arm64"
  fi

  if [[ ! -d "$app_path" ]]; then
    echo "::error::Missing packaged app: $app_path" >&2
    return 1
  fi

  echo "📦 $app_path ($expected_arch)"
  echo "----------------------------------------"
  verify_macho_arch "$app_path/Contents/MacOS/Translator" "$expected_arch"
  verify_macho_arch \
    "$app_path/Contents/Resources/translator-owner-supervisor" \
    "$expected_arch"
  verify_macho_arch "$onnx_dir/onnxruntime_binding.node" "$expected_arch"

  local onnx_dylib
  onnx_dylib="$(find "$onnx_dir" -maxdepth 1 -name 'libonnxruntime*.dylib' -print -quit)"
  if [[ -z "$onnx_dylib" ]]; then
    echo "::error::Missing ONNX Runtime dylib in $onnx_dir" >&2
    return 1
  fi
  verify_macho_arch "$onnx_dylib" "$expected_arch"

  verify_macho_arch "$resources/webrtcvad/build/Release/vad.node" "$expected_arch"

  if [[ ! -d "$headless_dir" ]]; then
    echo "::error::Missing target-architecture headless browser directory: $headless_dir" >&2
    return 1
  fi
  if [[ -e "$app_resources/headless-$other_runtime_arch" ]]; then
    echo "::error::Unexpected non-target headless browser payload: $app_resources/headless-$other_runtime_arch" >&2
    return 1
  fi

  headless_binary="$(
    find "$headless_dir" -type f \
      \( -name 'chrome-headless-shell' -o -name 'headless_shell' \) \
      -print -quit
  )"
  if [[ -z "$headless_binary" ]]; then
    echo "::error::Missing headless browser executable in $headless_dir" >&2
    return 1
  fi
  verify_macho_arch "$headless_binary" "$expected_arch"
  echo
}

echo "🔍 Verifying executable native payloads…"
echo
verify_app "dist/mac/Translator.app" "x86_64" "x64"
verify_app "dist/mac-arm64/Translator.app" "arm64" "arm64"

echo "✅ Both packaged apps contain loadable native payloads for their target architecture."
