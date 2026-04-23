#!/usr/bin/env bash
set -euo pipefail
# Real-API smoke test. Requires OPENAI_API_KEY in env.
# Usage: scripts/smoke.sh

: "${OPENAI_API_KEY:?OPENAI_API_KEY required}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== generate =="
gpt-image-cli generate -p "a small blue circle on white" -s 1024x1024 -q low --out "$TMP/gen.png"
test -s "$TMP/gen.png" && echo "OK: gen.png written ($(wc -c < "$TMP/gen.png") bytes)"

echo "== edit =="
gpt-image-cli edit --image "$TMP/gen.png" -p "make the circle red" --out "$TMP/edit.png"
test -s "$TMP/edit.png" && echo "OK: edit.png written ($(wc -c < "$TMP/edit.png") bytes)"

echo "All smoke checks passed."
