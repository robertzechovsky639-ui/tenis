#!/usr/bin/env bash
# Sestaví statický web do dist/
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp -r web/* dist/
BUILD=$(date +%Y%m%d%H%M)
sed -i "s/__BUILD__/$BUILD/" dist/sw.js
echo "dist: $(find dist -type f | wc -l) souborů, $(du -sh dist | cut -f1)"
