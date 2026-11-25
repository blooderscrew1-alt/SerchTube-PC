from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "app-icon.webp"
BG = (18, 32, 56, 255)

src = Image.open(SOURCE).convert("RGBA")
w, h = src.size


def resized(size):
    return src.resize((size, size), Image.LANCZOS)


def with_background(icon, size, padding_ratio=0.0, circular=False):
    canvas = Image.new("RGBA", (size, size), BG)
    inner = int(size * (1 - padding_ratio * 2))
    art = icon.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    if circular:
        mask = Image.new("L", (inner, inner), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, inner, inner), fill=255)
        canvas.paste(art, (offset, offset), mask)
    else:
        canvas.paste(art, (offset, offset), art)
    return canvas


# PWA
resized(192).save(ROOT / "public" / "pwa-192x192.png", "PNG")
resized(512).save(ROOT / "public" / "pwa-512x512.png", "PNG")
with_background(src, 512, 0.10).save(ROOT / "public" / "pwa-maskable-512x512.png", "PNG")
with_background(src, 180).save(ROOT / "public" / "apple-touch-icon.png", "PNG")
resized(64).save(ROOT / "public" / "favicon.png", "PNG")

# Android launcher legacy
android = ROOT / "android" / "res"
for density, size in {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}.items():
    folder = android / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    resized(size).save(folder / "ic_launcher.png", "PNG")
    with_background(src, size, 0.0, circular=True).save(folder / "ic_launcher_round.png", "PNG")

# Android adaptive foreground: 432x432 with safe padding
(android / "drawable").mkdir(parents=True, exist_ok=True)
foreground = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
inner = 286
art = src.resize((inner, inner), Image.LANCZOS)
foreground.paste(art, ((432 - inner) // 2, (432 - inner) // 2), art)
foreground.save(android / "drawable" / "ic_launcher_foreground.png", "PNG")

(android / "values").mkdir(parents=True, exist_ok=True)
(android / "values" / "colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources>\n'
    '    <color name="icon_bg">#122038</color>\n'
    '</resources>\n',
    encoding="utf-8",
)

adaptive = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@color/icon_bg" />\n'
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
    '</adaptive-icon>\n'
)
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    folder = android / "mipmap-anydpi-v26"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(adaptive, encoding="utf-8")

print("Iconos generados desde", SOURCE)
