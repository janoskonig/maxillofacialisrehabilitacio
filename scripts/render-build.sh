#!/usr/bin/env bash
set -euo pipefail

export SKIP_BUILD_CHECKS=true
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

npm ci
npm run build

test -f .next/BUILD_ID || {
  echo "Build failed: .next/BUILD_ID missing"
  exit 1
}
