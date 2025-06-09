#!/usr/bin/env bash
set -euo pipefail

TARGET_ARCH=x64
echo "🔨  Rebuilding native modules for $TARGET_ARCH …"

# 1. fresh production-only install under Rosetta
rm -rf node_modules
arch -x86_64 npm ci --production --no-audit --fund=false

# 2. rebuild *every* native add-on that ended up in node_modules
arch -x86_64 npx @electron/rebuild   \
  --arch $TARGET_ARCH                \
  --parallel                         \
  --types prod,optional              \
  --force                            \
  --module-dir node_modules

echo "✅  Native add-ons ready for $TARGET_ARCH" 