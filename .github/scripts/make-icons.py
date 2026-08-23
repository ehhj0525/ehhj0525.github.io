"""Draw the home-screen icons from icon.svg.

Run by hand, and only when the mark changes:

    brew install librsvg          # for rsvg-convert
    python3 .github/scripts/make-icons.py

The icons are committed rather than generated on every build. They change about
as often as the site is renamed, and a phone that has installed the app keeps
whatever it was given until the manifest changes -- so there is nothing for a
build to keep up to date, and one fewer moving part in the pipeline.

Three sizes and three jobs:

* 192 and 512 are what Android asks for, and what makes the site installable at
  all rather than a bookmark that opens in a browser tab.
* The maskable one is the same leaf with room around it. Android crops an icon
  to whatever shape the phone's launcher uses -- a circle, a squircle -- and
  only the middle 80% is guaranteed to survive, so the leaf is drawn smaller
  inside a full field of the site's cream.
* apple-touch-icon is what iOS reads; it ignores the manifest's icons for
  Add to Home Screen. iOS rounds the corners itself and shows transparency as
  black, which is why every one of these is opaque.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "icon.svg"
ICONS = ROOT / "icons"

# The site's --bg. The SVG paints it too; this is for the padding around a
# maskable icon, which is added here rather than in the drawing.
CREAM = (251, 249, 246, 255)

# What Android is allowed to crop to. 80% is the guaranteed-visible circle, so
# the leaf is drawn inside it with a little to spare.
SAFE_FRACTION = 0.72


def render(size: int, out: Path) -> Path:
    """Rasterise icon.svg at `size` px square."""
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), str(SOURCE), "-o", str(out)],
        check=True,
    )
    return out


def render_maskable(size: int, out: Path) -> Path:
    """The leaf, smaller, on a full field of cream — safe under any launcher mask."""
    inner = round(size * SAFE_FRACTION)
    leaf = render(inner, out.with_suffix(".tmp.png"))

    canvas = Image.new("RGBA", (size, size), CREAM)
    with Image.open(leaf) as drawn:
        offset = (size - inner) // 2
        canvas.alpha_composite(drawn.convert("RGBA"), (offset, offset))
    canvas.save(out)
    leaf.unlink()
    return out


def main() -> int:
    if not SOURCE.exists():
        print(f"no {SOURCE.name} to draw from", file=sys.stderr)
        return 1

    written = [
        render(192, ICONS / "icon-192.png"),
        render(512, ICONS / "icon-512.png"),
        render(180, ICONS / "apple-touch-icon.png"),
        render_maskable(512, ICONS / "maskable-512.png"),
    ]
    for path in written:
        print(f"  {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
