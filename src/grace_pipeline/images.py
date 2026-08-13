"""Turning whatever the phone produced into something a browser can show."""

from __future__ import annotations

import hashlib
from pathlib import Path

from PIL import Image, ImageOps

try:  # HEIC is the iPhone default and no browser can display it.
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover - the pipeline installs it; tests do not need it
    pass

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}

WEB_MAX_EDGE = 2048
THUMB_MAX_EDGE = 400
WEB_QUALITY = 82
THUMB_QUALITY = 78


def is_photo(path: Path) -> bool:
    return path.is_file() and not path.name.startswith(".") and path.suffix.lower() in SUPPORTED_SUFFIXES


def content_hash(path: Path) -> str:
    """Identify a photo by its bytes, so the same upload twice is the same photo."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:16]


def open_photo(path: Path) -> Image.Image:
    image = Image.open(path)
    image.load()
    return image


def write_renditions(image: Image.Image, web_path: Path, thumb_path: Path) -> None:
    """Write the web version and thumbnail, upright and stripped of metadata."""
    upright = ImageOps.exif_transpose(image) or image
    flattened = _flatten(upright)

    _write_jpeg(flattened, web_path, WEB_MAX_EDGE, WEB_QUALITY)
    _write_jpeg(flattened, thumb_path, THUMB_MAX_EDGE, THUMB_QUALITY)


def _write_jpeg(image: Image.Image, path: Path, max_edge: int, quality: int) -> None:
    resized = image.copy()
    resized.thumbnail((max_edge, max_edge), Image.LANCZOS)  # never upscales
    path.parent.mkdir(parents=True, exist_ok=True)
    resized.save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def _flatten(image: Image.Image) -> Image.Image:
    """JPEG has no alpha channel; compose transparent images onto white."""
    if image.mode == "RGB":
        return image
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        return canvas
    return image.convert("RGB")
