from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
SIZE = 1024
PANEL_BOX = (34, 34, 990, 990)
PANEL_RADIUS = 224
BASE_COLOR = (0x3A, 0x4A, 0x35, 153)  # 60% alpha


def make_panel() -> tuple[Image.Image, Image.Image]:
    panel_mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(panel_mask).rounded_rectangle(
        PANEL_BOX,
        radius=PANEL_RADIUS,
        fill=255,
    )

    panel = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base = Image.new("RGBA", (SIZE, SIZE), BASE_COLOR)
    panel.alpha_composite(Image.composite(base, Image.new("RGBA", base.size), panel_mask))

    # A restrained frosted-glass sheen. The central plate remains #3A4A35 at
    # approximately 60% alpha, while only the light-catching edge varies.
    sheen_mask = Image.new("L", (SIZE, SIZE), 0)
    sheen_draw = ImageDraw.Draw(sheen_mask)
    sheen_draw.ellipse((-260, -340, 900, 470), fill=38)
    sheen_mask = sheen_mask.filter(ImageFilter.GaussianBlur(110))
    sheen_mask = Image.composite(sheen_mask, Image.new("L", sheen_mask.size), panel_mask)
    sheen = Image.new("RGBA", (SIZE, SIZE), (225, 238, 218, 0))
    sheen.putalpha(sheen_mask)
    panel.alpha_composite(sheen)

    border = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.rounded_rectangle(
        PANEL_BOX,
        radius=PANEL_RADIUS,
        outline=(226, 239, 220, 88),
        width=4,
    )
    border_draw.rounded_rectangle(
        (42, 42, 982, 982),
        radius=PANEL_RADIUS - 8,
        outline=(255, 255, 255, 30),
        width=2,
    )
    panel.alpha_composite(border)
    return panel, panel_mask


def fit_character(source: Image.Image, variant: str) -> tuple[Image.Image, tuple[int, int]]:
    alpha = source.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 12 else 0).getbbox()
    if bbox is None:
        raise ValueError(f"cutout-{variant}.png has no visible pixels")
    subject = source.crop(bbox)

    limits = {
        "a": (900, 900, 966),
        "b": (860, 880, 962),
        "c": (884, 860, 950),
    }
    max_width, max_height, bottom = limits[variant]
    scale = min(max_width / subject.width, max_height / subject.height)
    resized = subject.resize(
        (round(subject.width * scale), round(subject.height * scale)),
        Image.Resampling.LANCZOS,
    )
    x = (SIZE - resized.width) // 2
    y = bottom - resized.height
    return resized, (x, y)


def compose(variant: str) -> None:
    cutout = Image.open(ROOT / f"cutout-{variant}.png").convert("RGBA")
    character, position = fit_character(cutout, variant)
    panel, panel_mask = make_panel()

    shadow_alpha = character.getchannel("A").filter(ImageFilter.GaussianBlur(18))
    shadow = Image.new("RGBA", character.size, (7, 12, 8, 0))
    shadow.putalpha(shadow_alpha.point(lambda value: round(value * 0.25)))
    shadow_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_layer.alpha_composite(shadow, (position[0] + 8, position[1] + 16))
    shadow_layer.putalpha(Image.composite(shadow_layer.getchannel("A"), Image.new("L", (SIZE, SIZE)), panel_mask))
    panel.alpha_composite(shadow_layer)
    panel.alpha_composite(character, position)

    panel.save(ROOT / f"whale-maid-glass-{variant}.png", optimize=True)


if __name__ == "__main__":
    for name in ("a", "b", "c"):
        compose(name)
