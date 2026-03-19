#!/usr/bin/env bash
set -euo pipefail

echo "=== Railway startup shim ==="

if [ -f "main.py" ]; then
  echo "Python entrypoint detected. Starting Python service."
  exec python main.py
fi

if [ -f "package.json" ]; then
  echo "Node app detected. Starting npm service."
  exec npm run start
fi

echo "No supported application entrypoint found."
exit 1
