#!/usr/bin/env bash
# Install the EXACT tagged tarball into a throwaway consumer and resolve both
# exports. This is the only check that proves what a consumer actually gets:
# a source tree with no build step, so a stale dist/ fails here.
#
# The repo is private, so the plain archive URL 404s without credentials. We try
# it first (it is what a consumer with access uses) and fall back to the same
# tarball fetched through the gh CLI.
set -euo pipefail
TAG="${1:?tag, e.g. v0.1.0}"
REPO="capoyeti/report-a-problem"
URL="https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz"

D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT
cd "$D"
npm init -y >/dev/null

SPEC="$URL"
if ! curl -fsSL -o /dev/null "$URL" 2>/dev/null; then
  echo "archive URL not public, fetching ${TAG} via gh"
  gh api "repos/${REPO}/tarball/${TAG}" > "$D/pkg.tar.gz"
  SPEC="$D/pkg.tar.gz"
fi

npm i --no-audit --no-fund "$SPEC" react react-dom lucide-react html2canvas >/dev/null
node -e "import('@visibleprojects/report-a-problem').then(m => { if (typeof m.createReportProblemHandlers !== 'function') process.exit(1); })"
test -f node_modules/@visibleprojects/report-a-problem/dist/style.css
head -1 node_modules/@visibleprojects/report-a-problem/dist/client/ReportProblemPanel.js | grep -q "use client"
echo "smoke ok: $TAG"
