#!/usr/bin/env python3
"""Generate PWA icons with the standard library only (no Pillow on this Mac).

Draws a brand-gradient square with a bold white checkmark — a "done / progress"
mark that suits a rehab tracker and reads at every size. Full-bleed so it works
as an iOS home-screen icon (iOS applies its own rounded mask) and as an Android
maskable icon (glyph kept inside the safe zone).
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"

# brand gradient endpoints (top -> bottom): accent blue -> violet
TOP = (0x5c, 0x92, 0xff)
BOT = (0x8a, 0x5c, 0xd6)


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def png(width, height, buf):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # RGBA, 8-bit
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw += buf[y * stride:(y + 1) * stride]
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def thick_segment(px, py, qx, qy, half, plot):
    """Draw a rounded-cap thick line by stamping discs along the segment."""
    steps = int(max(abs(qx - px), abs(qy - py))) + 1
    for i in range(steps + 1):
        t = i / steps
        cx = px + (qx - px) * t
        cy = py + (qy - py) * t
        r = int(half) + 1
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= half * half:
                    plot(int(cx + dx), int(cy + dy))


def build(size):
    buf = bytearray(size * size * 4)

    def setpx(x, y, rgba):
        if 0 <= x < size and 0 <= y < size:
            o = (y * size + x) * 4
            buf[o:o + 4] = bytes(rgba)

    # gradient background, full bleed
    for y in range(size):
        t = y / (size - 1)
        col = (lerp(TOP[0], BOT[0], t), lerp(TOP[1], BOT[1], t), lerp(TOP[2], BOT[2], t), 255)
        for x in range(size):
            o = (y * size + x) * 4
            buf[o:o + 4] = bytes(col)

    # checkmark, kept within the central safe zone
    white = set()

    def mark(x, y):
        white.add((x, y))

    half = size * 0.052
    thick_segment(size * 0.30, size * 0.53, size * 0.44, size * 0.67, half, mark)
    thick_segment(size * 0.44, size * 0.67, size * 0.72, size * 0.34, half, mark)
    # slight shadow for legibility, then the white stroke on top
    for (x, y) in white:
        setpx(x + max(1, int(size * 0.006)), y + max(1, int(size * 0.006)), (30, 40, 90, 90))
    for (x, y) in white:
        setpx(x, y, (255, 255, 255, 255))

    return png(size, size, buf)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        (OUT / name).write_bytes(build(size))
        print("wrote", name, size)


if __name__ == "__main__":
    main()
