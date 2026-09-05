#!/usr/bin/env python3
"""Generates the neon-glow open-hand cursor PNG frames for Manoo — the
same hand geometry AND blue mesh fill as the site's <svg class="hand-icon">
in site/index.html (viewBox 0 0 100 130: palm + 4 fingers + rotated thumb,
filled with a 9x9 mesh pattern, cyan stroke outline), scaled down for a
cursor — then compiles them into an Xcursor file via xcursorgen. Run once
(or whenever the look changes) — the output is committed, this script
isn't run at runtime."""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = Path(__file__).parent

# Same coordinate system as the site icon's viewBox (0 0 100 130), scaled
# down to cursor size. Keep this in sync if the site icon's hand shape
# ever changes.
SCALE = 0.6
W, H = round(100 * SCALE), round(130 * SCALE)
# Hotspot at the tip of the tallest (middle) finger — the natural
# "pointing" spot on an open hand, same convention as a pointer cursor.
HOT_X, HOT_Y = round(59 * SCALE), round(10 * SCALE)

MESH_BG = (4, 40, 63)
MESH_LINE = (63, 214, 255)
STROKE = (95, 232, 255)


def s(*vals):
    return [round(v * SCALE) for v in vals]


def hand_shapes(draw, fill, outline=None, width=1):
    kwargs = {"fill": fill}
    if outline:
        kwargs["outline"] = outline
        kwargs["width"] = width
    # Palm.
    draw.rounded_rectangle(s(25, 55, 75, 107), radius=round(20 * SCALE), **kwargs)
    # Fingers (pinky to index), matching the site icon's four rects.
    draw.rounded_rectangle(s(30, 25, 40, 60), radius=round(5 * SCALE), **kwargs)
    draw.rounded_rectangle(s(42, 14, 52, 60), radius=round(5 * SCALE), **kwargs)
    draw.rounded_rectangle(s(54, 10, 64, 60), radius=round(5 * SCALE), **kwargs)
    draw.rounded_rectangle(s(66, 17, 76, 58), radius=round(5 * SCALE), **kwargs)


def paste_thumb(base_rgba, fill, outline=None, width=1):
    tw, th = s(11, 32)
    pad = max(tw, th)
    canvas = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    kwargs = {"fill": fill}
    if outline:
        kwargs["outline"] = outline
        kwargs["width"] = width
    d.rounded_rectangle([pad, pad, pad + tw, pad + th], radius=round(5.5 * SCALE), **kwargs)
    canvas = canvas.rotate(38, resample=Image.BICUBIC, expand=True)
    cx, cy = s(17.5, 68)
    base_rgba.alpha_composite(canvas, (cx - canvas.width // 2, cy - canvas.height // 2))


def make_mask():
    """White-on-transparent silhouette of the whole hand, used to clip the
    mesh pattern to exactly the hand's shape (like the SVG's fill="url(#mesh)"
    only painting inside the hand paths)."""
    mask = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(mask)
    hand_shapes(d, (255, 255, 255, 255))
    paste_thumb(mask, (255, 255, 255, 255))
    return mask


def make_mesh_tile():
    cell = max(2, round(9 * SCALE))
    tile = Image.new("RGBA", (cell, cell), (*MESH_BG, 255))
    d = ImageDraw.Draw(tile)
    lw = max(1, round(0.7 * SCALE))
    d.line([(0, 0), (cell, 0)], fill=(*MESH_LINE, 217), width=lw)
    d.line([(0, 0), (0, cell)], fill=(*MESH_LINE, 217), width=lw)
    return tile


def make_mesh_fill():
    cell_img = make_mesh_tile()
    cell = cell_img.width
    fill = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            fill.paste(cell_img, (x, y))
    return fill


def make_frame(glow_blur, glow_alpha):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # Glow: blurred solid silhouette underneath everything.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    hand_shapes(d, (*STROKE, glow_alpha))
    paste_thumb(glow, (*STROKE, glow_alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(glow_blur))
    img.alpha_composite(glow)

    # Mesh-filled hand, clipped to the hand silhouette.
    mask = make_mask()
    mesh = make_mesh_fill()
    filled = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    filled.paste(mesh, (0, 0), mask)
    img.alpha_composite(filled)

    # Stroke outline on top, same as the SVG's stroke="#5fe8ff".
    outline_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(outline_layer)
    lw = max(1, round(2 * SCALE))
    hand_shapes(d, None, outline=(*STROKE, 255), width=lw)
    paste_thumb(outline_layer, None, outline=(*STROKE, 255), width=lw)
    img.alpha_composite(outline_layer)

    return img


frames = [
    make_frame(1.6, 160),
    make_frame(2.6, 210),
]

config_lines = []
for i, frame in enumerate(frames):
    png_path = OUT_DIR / f"cursor-frame-{i}.png"
    frame.save(png_path)
    config_lines.append(f"{H} {HOT_X} {HOT_Y} {png_path.name} 700")

config_path = OUT_DIR / "cursor.conf"
config_path.write_text("\n".join(config_lines) + "\n")

out_path = OUT_DIR / "left_ptr"
subprocess.run(
    ["xcursorgen", str(config_path.name), str(out_path.name)],
    cwd=OUT_DIR,
    check=True,
)
print("wrote", out_path, "size", (W, H), "hot", (HOT_X, HOT_Y))
