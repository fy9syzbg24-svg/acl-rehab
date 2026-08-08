#!/usr/bin/env bash
# Turn a source image into the app's Home Screen icons.
#
#   bash tools/set_icon.sh ~/Desktop/icon-source.png
#
# Uses sips, which ships with macOS — there is no Pillow or ImageMagick on this
# machine. The source should be SQUARE; anything else is centre-cropped first,
# because iOS masks the icon into a squircle and a stretched subject looks wrong.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:?usage: set_icon.sh <path-to-square-image>}"
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }

OUT="app/icons"
mkdir -p "$OUT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

W=$(sips -g pixelWidth  "$SRC" | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$SRC" | awk '/pixelHeight/{print $2}')
echo "source ${W}x${H}"

# Centre-crop to a square using the shorter edge.
SIDE=$(( W < H ? W : H ))
cp "$SRC" "$TMP/sq.png"
sips -c "$SIDE" "$SIDE" "$TMP/sq.png" >/dev/null      # -c crops from the centre

for spec in "icon-192.png 192" "icon-512.png 512" "apple-touch-icon.png 180"; do
  set -- $spec
  cp "$TMP/sq.png" "$TMP/$1"
  sips -z "$2" "$2" -s format png "$TMP/$1" --out "$OUT/$1" >/dev/null
  echo "wrote $OUT/$1  ($2x$2, $(du -h "$OUT/$1" | cut -f1))"
done

echo
echo "Now run:  bash tools/deploy.sh"
echo "Then on the phone, remove the Home Screen icon and re-add it — iOS caches"
echo "the old artwork and will not refresh it in place."
