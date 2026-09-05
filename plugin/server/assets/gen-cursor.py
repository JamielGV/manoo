#!/usr/bin/env python3
"""Generates the neon-glow cursor PNG frames for Manoo, then compiles them
into an Xcursor file via xcursorgen. Run once (or whenever the look
changes) — the output is committed, this script isn't run at runtime."""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = Path(__file__).parent
SIZE = 32
HOT = SIZE // 2  # center hotspot — precise enough for a glow-dot cursor


def make_frame(core_r, glow_r, core_color, glow_color, glow_alpha):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse(
        [HOT - glow_r, HOT - glow_r, HOT + glow_r, HOT + glow_r],
        fill=(*glow_color, glow_alpha),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(glow_r / 2.2))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    d.ellipse(
        [HOT - core_r, HOT - core_r, HOT + core_r, HOT + core_r],
        fill=(*core_color, 255),
    )
    return img


frames = [
    make_frame(3, 10, (255, 255, 255), (77, 216, 255), 180),
    make_frame(4, 13, (255, 255, 255), (77, 216, 255), 230),
]

config_lines = []
for i, frame in enumerate(frames):
    png_path = OUT_DIR / f"cursor-frame-{i}.png"
    frame.save(png_path)
    config_lines.append(f"{SIZE} {HOT} {HOT} {png_path.name} 700")

config_path = OUT_DIR / "cursor.conf"
config_path.write_text("\n".join(config_lines) + "\n")

out_path = OUT_DIR / "left_ptr"
subprocess.run(
    ["xcursorgen", str(config_path.name), str(out_path.name)],
    cwd=OUT_DIR,
    check=True,
)
print("wrote", out_path)
