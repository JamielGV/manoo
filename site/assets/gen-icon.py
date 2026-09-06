#!/usr/bin/env python3
"""Generates the Manoo hand icon as standalone PNGs — a favicon and an
Open Graph / social-preview image — from the exact same hand geometry and
mesh fill as the inline <svg class="hand-icon"> in site/index.html
(viewBox 0 0 100 130), so every place Manoo's icon appears (browser tab,
link previews on X/LinkedIn/Reddit, etc.) matches. No SVG-to-PNG tool
available in this environment (no rsvg-convert/inkscape/cairosvg) — drawn
directly with Pillow instead, same approach already used for the neon
cursor in gen-cursor.py. Run once (or whenever the icon design changes);
the output PNGs are committed, this script isn't run at runtime.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = Path(__file__).parent

SS = 6  # supersample factor for crisp downscaled edges
MESH_BG = (4, 40, 63)
MESH_LINE = (63, 214, 255)
STROKE = (95, 232, 255)
PAGE_BG = (11, 13, 16)  # site's --bg


def s(*vals, scale):
    return [round(v * scale) for v in vals]


def hand_shapes(draw, scale, fill, outline=None, width=1):
    kwargs = {"fill": fill}
    if outline:
        kwargs["outline"] = outline
        kwargs["width"] = width
    draw.rounded_rectangle(s(25, 55, 75, 107, scale=scale), radius=round(20 * scale), **kwargs)
    draw.rounded_rectangle(s(30, 25, 40, 60, scale=scale), radius=round(5 * scale), **kwargs)
    draw.rounded_rectangle(s(42, 14, 52, 60, scale=scale), radius=round(5 * scale), **kwargs)
    draw.rounded_rectangle(s(54, 10, 64, 60, scale=scale), radius=round(5 * scale), **kwargs)
    draw.rounded_rectangle(s(66, 17, 76, 58, scale=scale), radius=round(5 * scale), **kwargs)


def paste_thumb(base_rgba, scale, fill, outline=None, width=1):
    tw, th = s(11, 32, scale=scale)
    pad = max(tw, th)
    canvas = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    kwargs = {"fill": fill}
    if outline:
        kwargs["outline"] = outline
        kwargs["width"] = width
    d.rounded_rectangle([pad, pad, pad + tw, pad + th], radius=round(5.5 * scale), **kwargs)
    canvas = canvas.rotate(38, resample=Image.BICUBIC, expand=True)
    cx, cy = s(17.5, 68, scale=scale)
    base_rgba.alpha_composite(canvas, (cx - canvas.width // 2, cy - canvas.height // 2))


def make_mesh_tile(scale):
    cell = max(2, round(9 * scale))
    tile = Image.new("RGBA", (cell, cell), (*MESH_BG, 255))
    d = ImageDraw.Draw(tile)
    lw = max(1, round(0.7 * scale))
    d.line([(0, 0), (cell, 0)], fill=(*MESH_LINE, 217), width=lw)
    d.line([(0, 0), (0, cell)], fill=(*MESH_LINE, 217), width=lw)
    return tile


def render_hand(final_size, glow=True):
    """Renders the hand icon at final_size x (final_size * 1.3), matching
    the SVG's 100x130 aspect ratio, supersampled and downscaled for crisp
    edges, optionally with a soft neon glow behind it."""
    scale = SS * (final_size / 100)
    w, h = round(100 * scale), round(130 * scale)

    mask = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(mask)
    hand_shapes(d, scale, (255, 255, 255, 255))
    paste_thumb(mask, scale, (255, 255, 255, 255))

    cell_img = make_mesh_tile(scale)
    cell = cell_img.width
    mesh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            mesh.paste(cell_img, (x, y))

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    if glow:
        glow_layer = Image.new("RGBA", (w, h), (*STROKE, 0))
        gd = ImageDraw.Draw(glow_layer)
        hand_shapes(gd, scale, (*STROKE, 255))
        paste_thumb(glow_layer, scale, (*STROKE, 255))
        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(scale * 3))
        r, g, b, a = glow_layer.split()
        a = a.point(lambda v: int(v * 200 / 255))
        glow_layer = Image.merge("RGBA", (r, g, b, a))
        img.alpha_composite(glow_layer)

    filled = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    filled.paste(mesh, (0, 0), mask)
    img.alpha_composite(filled)

    outline_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(outline_layer)
    lw = max(1, round(2 * scale))
    hand_shapes(od, scale, None, outline=(*STROKE, 255), width=lw)
    paste_thumb(outline_layer, scale, None, outline=(*STROKE, 255), width=lw)
    img.alpha_composite(outline_layer)

    final_h = round(final_size * 1.3)
    return img.resize((final_size, final_h), Image.LANCZOS)


# --- Favicon: square, transparent background, hand centered ---
hand_512 = render_hand(420, glow=True)
favicon = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
favicon.alpha_composite(hand_512, ((512 - hand_512.width) // 2, (512 - hand_512.height) // 2))
favicon.save(OUT_DIR / "favicon.png")
for sz in (16, 32, 180):
    favicon.resize((sz, sz), Image.LANCZOS).save(OUT_DIR / f"favicon-{sz}.png")
print("wrote favicon.png + favicon-{16,32,180}.png")

# --- Open Graph / social preview image: 1200x630, dark bg, hand + wordmark ---
og = Image.new("RGB", (1200, 630), PAGE_BG)
hand_og = render_hand(340, glow=True)
og.paste(hand_og, (140, (630 - hand_og.height) // 2), hand_og)

draw = ImageDraw.Draw(og)
try:
    font_big = ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 96
    )
    font_small = ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34
    )
except OSError:
    font_big = ImageFont.load_default()
    font_small = ImageFont.load_default()

text_x = 140 + hand_og.width + 40
draw.text((text_x, 230), "Manoo", font=font_big, fill=(232, 236, 241))
draw.text(
    (text_x, 350),
    "Gives Claude Code hands",
    font=font_small,
    fill=(139, 147, 161),
)

og.save(OUT_DIR / "og-image.png")
print("wrote og-image.png", og.size)
