#!/usr/bin/env bash
# 需要 macOS 內建的 qlmanage 與 sips；其他平台可改用 rsvg-convert。
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
qlmanage -t -s 128 -o "$tmp" icons/icon.svg >/dev/null 2>&1
mv "$tmp/icon.svg.png" icons/icon128.png
for s in 48 16; do
  sips -z "$s" "$s" icons/icon128.png --out "icons/icon$s.png" >/dev/null
done
rm -rf "$tmp"
echo "icons generated"
