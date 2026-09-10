"""
Generate deterministic test manga for Suwayomi's built-in Local source.

Exercises the whole pipeline with no third-party repository: listSources ->
search -> chapters -> pages -> /api/proxy -> reader. Also covers the layouts a
reader gets wrong: a double-page spread, a tall webtoon strip, and pages of
inconsistent size.

    python fixtures/gen_local.py out/
    docker cp out/. lacrima-suwayomi:/home/suwayomi/.local/share/Tachidesk/local/
"""

import json
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

PALETTE = [
    (36, 43, 71), (71, 36, 45), (36, 71, 52),
    (66, 51, 82), (82, 66, 36), (36, 74, 78),
]


def page(w: int, h: int, label: str, sub: str, rgb) -> Image.Image:
    img = Image.new("RGB", (w, h), rgb)
    d = ImageDraw.Draw(img)

    # Frame + centre marks so cropping, fit modes and page order are all visible.
    d.rectangle([8, 8, w - 9, h - 9], outline=(235, 235, 235), width=4)
    d.line([w // 2, 0, w // 2, 40], fill=(235, 235, 235), width=3)
    d.line([w // 2, h - 40, w // 2, h], fill=(235, 235, 235), width=3)

    size = max(w, h) // 6
    try:
        from PIL import ImageFont
        font = ImageFont.truetype("arial.ttf", size)
        small = ImageFont.truetype("arial.ttf", max(size // 5, 14))
    except Exception:
        font = small = None

    box = d.textbbox((0, 0), label, font=font)
    d.text(((w - box[2]) / 2, (h - box[3]) / 2 - size // 3), label,
           fill=(245, 245, 245), font=font)

    box2 = d.textbbox((0, 0), sub, font=small)
    d.text(((w - box2[2]) / 2, h * 0.72), sub, fill=(200, 200, 200), font=small)
    return img


def chapter_cbz(path: Path, specs, label_of, sub, colour) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for i, (w, h) in enumerate(specs, start=1):
            img = page(w, h, label_of(i), sub, colour)
            tmp = path.parent / f".p{i:03}.jpg"
            img.save(tmp, "JPEG", quality=82)
            z.write(tmp, f"{i:03}.jpg")
            tmp.unlink()


def series(root: Path, title: str, artist: str, description: str, genres) -> Path:
    d = root / title
    d.mkdir(parents=True, exist_ok=True)
    (d / "details.json").write_text(json.dumps({
        "title": title,
        "author": artist,
        "artist": artist,
        "description": description,
        "genre": genres,
        "status": "2",
    }, indent=2), encoding="utf-8")
    page(900, 1200, title.split()[-1], title, PALETTE[0]).save(d / "cover.jpg", quality=85)
    return d


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)

    # 1. Ordinary paged manga, with a double-page spread in the middle.
    a = series(out, "Lacrima Test Pages", "Fixture Generator",
               "Numbered pages for verifying reading order, fit modes and preloading. "
               "Chapter 2 contains a double-width spread.",
               ["Test", "Paged"])
    for ch in range(1, 5):
        colour = PALETTE[ch % len(PALETTE)]
        specs = [(1200, 1800)] * 10
        if ch == 2:
            specs.insert(4, (2400, 1800))          # spread
            specs.insert(7, (1000, 1500))          # odd size
        chapter_cbz(a / f"Chapter {ch}.cbz", specs,
                    lambda i: str(i), f"Test Pages · ch {ch}", colour)

    # 2. Long vertical strips, for webtoon/continuous mode.
    b = series(out, "Lacrima Test Webtoon", "Fixture Generator",
               "Tall strips for verifying continuous vertical scrolling.",
               ["Test", "Webtoon"])
    for ch in range(1, 3):
        colour = PALETTE[(ch + 2) % len(PALETTE)]
        chapter_cbz(b / f"Chapter {ch}.cbz", [(800, 3600)] * 4,
                    lambda i: str(i), f"Test Webtoon · ch {ch}", colour)

    total = sum(1 for _ in out.rglob("*.cbz"))
    print(f"wrote {total} chapters under {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "out"))
