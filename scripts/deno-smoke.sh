#!/usr/bin/env bash
# Packs the SDK and runs deno/smoke.ts against the tarball, the way a Deno or Supabase
# Edge Function project loads it (npm package code from node_modules, not the sources).
# Needs node/npm (to build and pack) and deno on PATH. Usage: scripts/deno-smoke.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

npm run build >/dev/null
tarball="$root/$(npm pack --silent | tail -n 1)"
trap 'rm -f "$tarball"; rm -rf "$root/deno/node_modules"' EXIT

(cd deno && npm install --no-save --no-package-lock --silent "$tarball")

# Run from deno/ so Deno resolves @proofage/node from deno/node_modules, not the repo itself.
cd deno
deno run --allow-net=127.0.0.1 --allow-env --allow-read --no-prompt smoke.ts
