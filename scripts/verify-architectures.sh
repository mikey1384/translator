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
  local onnx_dir="$resources/onnxruntime-node/bin/napi-v6/darwin/$runtime_arch"

  if [[ ! -d "$app_path" ]]; then
    echo "::error::Missing packaged app: $app_path" >&2
    return 1
  fi

  echo "📦 $app_path ($expected_arch)"
  echo "----------------------------------------"
  verify_macho_arch "$app_path/Contents/MacOS/Translator" "$expected_arch"
  verify_macho_arch "$onnx_dir/onnxruntime_binding.node" "$expected_arch"

  local onnx_dylib
  onnx_dylib="$(find "$onnx_dir" -maxdepth 1 -name 'libonnxruntime*.dylib' -print -quit)"
  if [[ -z "$onnx_dylib" ]]; then
    echo "::error::Missing ONNX Runtime dylib in $onnx_dir" >&2
    return 1
  fi
  verify_macho_arch "$onnx_dylib" "$expected_arch"

  verify_macho_arch "$resources/webrtcvad/build/Release/vad.node" "$expected_arch"
  echo
}

echo "🔍 Verifying executable native payloads…"
echo
verify_app "dist/mac/Translator.app" "x86_64" "x64"
verify_app "dist/mac-arm64/Translator.app" "arm64" "arm64"

echo "✅ Both packaged apps contain loadable native payloads for their target architecture."
