#!/usr/bin/env bash
set -e

echo "🚀 Translator Release Checklist"
echo "=============================="
echo

echo "1️⃣  Clean install..."
npm run clean
npm ci --no-audit --fund=false

echo
echo "🔎 Running release validation..."
npm run lint
npm test
npm run security:dependencies

echo
echo "2️⃣  Building both architectures without publishing..."
npm run package:mac

echo
echo "3️⃣  Verifying native module architectures..."
npm run verify:architectures

echo
echo "4️⃣  Ready for smoke testing!"
echo "   Run these commands manually to test both builds:"
echo
echo "   # Test Apple Silicon build natively:"
echo "   open dist/mac-arm64/Translator.app"
echo "   # or: dist/mac-arm64/Translator.app/Contents/MacOS/Translator &"
echo 
echo "   # Test Intel build under Rosetta:"
echo "   arch -x86_64 open dist/mac/Translator.app"
echo "   # or: arch -x86_64 dist/mac/Translator.app/Contents/MacOS/Translator &"
echo
echo "5️⃣  If both launch without bouncing, you're ready to:"
echo "   • Stage and review the exact version bump and release changes"
echo "   • Create an annotated SemVer tag with non-empty release notes"
echo "   • Push the approved commit and tag together"
echo "   • Let the tag-triggered GitHub Action rebuild, sign, notarize, verify,"
echo "     upload, and publish the release; never upload SemVer assets manually"
