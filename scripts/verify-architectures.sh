#!/usr/bin/env bash
set -e

echo "🔍 Verifying native module architectures…"
echo

for app_path in "dist"/mac*/**/*.app; do
  [[ -d "$app_path" ]] || continue
  echo "📦 $app_path"
  echo "----------------------------------------"
  while IFS= read -r -d '' nodefile; do
    if command -v lipo >/dev/null 2>&1; then
      printf "  %-50s %s\n" "$(basename "$nodefile")" "$(lipo -archs "$nodefile")"
    else
      printf "  %-50s %s\n" "$(basename "$nodefile")" "$(file "$nodefile" | sed 's/.*: //')"
    fi
  done < <(find "$app_path" -name '*.node' -print0)
  echo
done

echo "✅ Expectation:"
echo "   • Intel build: all nodes → x86_64"
echo "   • Apple-Silicon build: all nodes → arm64" 