#!/usr/bin/env bash
# Publish app/ to the gh-pages branch, which GitHub Pages serves at
# https://<user>.github.io/acl-rehab/
#
# Deliberately not a GitHub Action: the gh CLI token here lacks `workflow`
# scope, and a static PWA needs no build. This does the two things a build
# would have done, then pushes app/ as the branch root.
set -euo pipefail
cd "$(dirname "$0")/.."

# The precache list is generated, never hand-edited: a view added and not
# listed is missing offline and updates on its own schedule.
python3 "$(dirname "$0")/gen_shell.py"

SHA=$(git rev-parse --short HEAD)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -R app/. "$STAGE/"

# 1. The service worker only refreshes its precache when its own bytes change.
#    Stamping the commit means every deploy invalidates the old shell.
sed -i '' "s/const SHELL_VERSION = '[^']*';/const SHELL_VERSION = '$SHA';/" "$STAGE/sw.js"

# 2. index.html is the DESKTOP app. On Pages the phone should land on mobile,
#    so keep the desktop one under its own name and make the ROOT the mobile
#    app itself.
#
#    It must be a COPY, not a redirect. iOS reads apple-mobile-web-app-capable
#    and apple-mobile-web-app-status-bar-style from the exact page you Add to
#    Home Screen. A redirect stub carries none of them, so iOS refused to
#    extend the web view into the safe areas and letterboxed the app with black
#    system bands top and bottom — which no CSS can fill.
mv "$STAGE/index.html" "$STAGE/desktop.html"
cp "$STAGE/m.html" "$STAGE/index.html"

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
