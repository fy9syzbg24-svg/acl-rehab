#!/usr/bin/env bash
# Publish app/ to the gh-pages branch, which GitHub Pages serves at
# https://<user>.github.io/acl-rehab/
#
# Deliberately not a GitHub Action: the gh CLI token here lacks `workflow`
# scope, and a static PWA needs no build. This does the two things a build
# would have done, then pushes app/ as the branch root.
set -euo pipefail
cd "$(dirname "$0")/.."

SHA=$(git rev-parse --short HEAD)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -R app/. "$STAGE/"

# 1. The service worker only refreshes its precache when its own bytes change.
#    Stamping the commit means every deploy invalidates the old shell.
sed -i '' "s/const SHELL_VERSION = '[^']*';/const SHELL_VERSION = '$SHA';/" "$STAGE/sw.js"

# 2. index.html is the DESKTOP app. On Pages the phone should land on mobile,
#    so keep the desktop one under its own name and redirect the root.
mv "$STAGE/index.html" "$STAGE/desktop.html"
cat > "$STAGE/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="0; url=./m.html"><title>Rehab tracker</title>
</head><body><a href="./m.html">Open the app</a></body></html>
HTML

# 3. Stop Pages running the content through Jekyll (which drops _-prefixed files).
touch "$STAGE/.nojekyll"

# Dev-only harness never ships.
rm -f "$STAGE"/dev-*.html "$STAGE"/dev-*.js "$STAGE/data/case.local.js"

WORK=$(mktemp -d)
git worktree add -q --detach "$WORK"
pushd "$WORK" >/dev/null
# A uniquely named orphan each time: `--orphan gh-pages` fails outright once
# the branch exists locally, which broke every deploy after the first.
TMPBRANCH="deploy-$$-$SHA"
git checkout -q --orphan "$TMPBRANCH"
git rm -rqf . >/dev/null 2>&1 || true
cp -R "$STAGE/." .
git add -A
git -c user.name="Reuben" -c user.email="reuben.moreland@gmail.com" \
    commit -q -m "Deploy $SHA"
git push -q -f origin "$TMPBRANCH":gh-pages
popd >/dev/null
git worktree remove --force "$WORK"

echo "deployed $SHA to gh-pages"
