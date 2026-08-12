#!/usr/bin/env python3
"""Generate the DMG installer background, version-stamped.

Runs on every `tauri build` (wired into beforeBuildCommand) so the installer
always shows the release it contains. Layout is computed, not hand-placed:
the wordmark, version line and app→Applications arrow are all centered on the
660x440 window, with the arrow on the exact y of the icon row configured in
tauri.conf.json (appPosition/applicationFolderPosition).

The "parker" wordmark is lifted pixel-for-pixel from the brand asset
(site/brand rendering baked into the previous background) so the typography
stays exactly on-brand without needing the Geist Mono font installed.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF = os.path.join(ROOT, "src-tauri", "tauri.conf.json")
WORDMARK_SRC = os.path.join(ROOT, "src-tauri", "dmg-wordmark.png")
OUT = os.path.join(ROOT, "src-tauri", "dmg-background.png")

W, H = 660, 440

conf = json.load(open(CONF))
version = conf["version"]
dmg = conf["bundle"]["macOS"]["dmg"]
icon_y = dmg["appPosition"]["y"]  # arrow must sit on the icon row
app_x = dmg["appPosition"]["x"]
folder_x = dmg["applicationFolderPosition"]["x"]

img = Image.new("RGB", (W, H))
px = img.load()
# Vertical near-black gradient, matching the previous background's look.
top, bottom = 0x17, 0x00
for y in range(H):
    v = round(top + (bottom - top) * y / (H - 1))
    for x in range(W):
        px[x, y] = (v, v, v)

# Wordmark, centered. dmg-wordmark.png is the cropped brand wordmark.
wm = Image.open(WORDMARK_SRC).convert("RGBA")
wm_y = 96
img.paste(wm, ((W - wm.width) // 2, wm_y), wm)

draw = ImageDraw.Draw(img)

# Version line, centered under the wordmark.
font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 20, index=0)
label = f"v{version}"
tw = draw.textlength(label, font=font)
draw.text(((W - tw) / 2, wm_y + wm.height + 18), label, font=font, fill=(154, 154, 154))

# App → Applications arrow, centered between the two icons, on their row.
mid = (app_x + folder_x) / 2
half = 72
y = icon_y - 2  # optical: icon glyphs sit a hair above their center
draw.line([(mid - half, y), (mid + half - 12, y)], fill=(255, 255, 255), width=3)
draw.polygon(
    [(mid + half, y), (mid + half - 14, y - 7), (mid + half - 14, y + 7)],
    fill=(255, 255, 255),
)

img.save(OUT)
print(f"dmg background: {OUT} (v{version})", file=sys.stderr)
