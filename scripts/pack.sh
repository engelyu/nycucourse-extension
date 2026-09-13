#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/nycucourse-extension-$version.zip"
rm -f "$out"
zip -r "$out" manifest.json src icons -x '*.DS_Store' >/dev/null
echo "$out"
unzip -l "$out"
