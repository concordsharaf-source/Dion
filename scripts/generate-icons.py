#!/usr/bin/env python3
"""
مُولِّد أيقونات التطبيق — مصدر واحد للحقيقة.

المشكلة التي حلّها هذا الملف:
    الأيقونة السابقة كانت مربّعًا بحواف دائرية داخل لوحة بيضاء، فظهرت
    **حواف بيضاء** حول الأيقونة على شاشة الجهاز (المشغّل يقصّ على شكل
    دائرة/مربّع دائرية، والأبيض ظاهر). وأيقونة maskable كانت مصغّرة جدًا
    داخل منطقة الأمان فتظهر صغيرة في المنتصف.

القاعدة الآن:
    · كل الأيقونات **ممتلئة حتى الحافة** (full bleed) بلا فراغات —
      المشغّل نفسه هو من يقصّ (دائرة/مربّع دائرية) ولا أبيض حولها.
    · نسختان: `any` (الرسم بحجمه الطبيعي) و`maskable` (الرسم داخل دائرة
      الأمان 80٪) — وهما المطلوبان في manifest ليعمل على كل الأجهزة.

التشغيل:  python3 scripts/generate-icons.py
المتطلبات: Pillow + numpy  (توليد بلا أي خدمة خارجية)
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "public" / "icons"
PUBLIC = ROOT / "public"

# ألوان الهوية (نفس ألوان التطبيق: brand-600 → brand-900)
BG_START = (18, 140, 100)  # #128c64
BG_END = (8, 52, 40)  # #08342
HIGHLIGHT = (255, 255, 255)
PAGE_LEFT = (255, 255, 255)
PAGE_RIGHT = (233, 246, 240)
SPINE = (206, 232, 220)
LINE = (15, 122, 90)
GOLD_LIGHT = (250, 208, 112)
GOLD = (232, 170, 52)
DARK = (10, 61, 47)

SS = 3  # معامل التكبير قبل التصغير (تنعيم الحواف)

Point = tuple[float, float]


def _scaled(points: list[Point], scale: float, cx: float, cy: float) -> list[Point]:
    """يُحجّم النقاط حول مركز اللوحة (0.5, 0.5) ثم يحرّكها إلى (cx, cy)."""
    out: list[Point] = []
    for x, y in points:
        out.append(((x - 0.5) * scale + cx, (y - 0.5) * scale + cy))
    return out


def _px(point: Point, size: int) -> Point:
    return (point[0] * size, point[1] * size)


def _poly(draw: ImageDraw.ImageDraw, points: list[Point], size: int, fill) -> None:
    draw.polygon([_px(p, size) for p in points], fill=fill)


def _rounded(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], radius: float, size: int, fill) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(
        (x0 * size, y0 * size, x1 * size, y1 * size),
        radius=radius * size,
        fill=fill,
    )


def background(size: int) -> Image.Image:
    """
    خلفية متدرّجة **ممتلئة بالكامل** (بلا أي حافة بيضاء):
    تدرّج قطري من الأخضر الفاتح إلى الداكن + وميض دائري خفيف في الأعلى.

    تُحسَب بالحجم النهائي (لا بحجم التكبير) لأن التدرّج ناعم أصلًا،
    ثم تُكبَّر بسلاسة — وهذا يمنع استهلاك ذاكرة ضخم عند 4096×4096.
    """
    y, x = np.mgrid[0:size, 0:size]
    nx = x / max(size - 1, 1)
    ny = y / max(size - 1, 1)
    # تدرّج قطري
    t = np.clip((nx * 0.55 + ny * 0.45), 0, 1).astype(np.float32)
    base = np.zeros((size, size, 3), dtype=np.float32)
    for c in range(3):
        base[..., c] = BG_START[c] * (1 - t) + BG_END[c] * t
    # وميض ناعم أعلى اليسار (عمق بصري بلا ضجيج)
    d = np.sqrt((nx - 0.26) ** 2 + (ny - 0.16) ** 2).astype(np.float32)
    glow = (np.clip(1 - d / 0.72, 0, 1) ** 2 * 0.16).astype(np.float32)
    base = base * (1 - glow[..., None]) + np.array(HIGHLIGHT) * glow[..., None]
    # تعتيم خفيف أسفل اليمين
    d2 = np.sqrt((nx - 0.88) ** 2 + (ny - 0.92) ** 2).astype(np.float32)
    shade = (np.clip(1 - d2 / 0.75, 0, 1) ** 2 * 0.18).astype(np.float32)
    base = base * (1 - shade[..., None]) + np.array(BG_END) * shade[..., None]
    return Image.fromarray(base.clip(0, 255).astype(np.uint8), "RGB").convert("RGBA")


def draw_mark(size: int, scale: float, draw: ImageDraw.ImageDraw) -> None:
    """
    يرسم الشعار: دفتر مفتوح + قطعة نقدية ذهبية + سهم سداد.
    الإحداثيات على لوحة 1×1 ثم تُحجَّم بـ scale حول المركز.
    """
    cx = cy = 0.5

    def pts(items: list[Point]) -> list[Point]:
        return _scaled(items, scale, cx, cy)

    def box(x0: float, y0: float, x1: float, y1: float) -> tuple[float, float, float, float]:
        (ax, ay), (bx, by) = _scaled([(x0, y0), (x1, y1)], scale, cx, cy)
        return (ax, ay, bx, by)

    # ظل ناعم (يُضاف لطبقة منفصلة وتُطمس لاحقًا) يفصل الشعار عن الخلفية
    # ---- الدفتر المفتوح ----
    _poly(draw, pts([(0.215, 0.345), (0.487, 0.308), (0.487, 0.642), (0.215, 0.679)]), size, PAGE_LEFT)
    _poly(draw, pts([(0.513, 0.308), (0.785, 0.345), (0.785, 0.679), (0.513, 0.642)]), size, PAGE_RIGHT)
    # الكعب + خيطه
    _rounded(draw, box(0.478, 0.296, 0.522, 0.654), 0.014, size, SPINE)
    _rounded(draw, box(0.4945, 0.310, 0.5055, 0.640), 0.005, size, (176, 214, 198))

    # ---- سطران لكل صفحة (أوضح في المقاسات الصغيرة) ----
    line_h = 0.028
    for y in (0.412, 0.507):
        _rounded(draw, box(0.268, y, 0.430, y + line_h), line_h / 2, size, LINE)
        _rounded(draw, box(0.570, y, 0.732, y + line_h), line_h / 2, size, LINE)

    # ---- القطعة النقدية (ذهب) على حافة الدفتر العليا ----
    coin_cx, coin_cy, coin_r = 0.685, 0.282, 0.108
    (ccx, ccy) = pts([(coin_cx, coin_cy)])[0]
    r = coin_r * scale
    draw.ellipse((size * (ccx - r), size * (ccy - r), size * (ccx + r), size * (ccy + r)), fill=GOLD)
    # لمعة خفيفة أعلى النقدية
    hl = r * 0.5
    draw.ellipse((size * (ccx - hl), size * (ccy - r * 0.95), size * (ccx + hl), size * (ccy - r * 0.34)), fill=GOLD_LIGHT)
    # الحلقة الداخلية
    r_in = r * 0.70
    draw.ellipse(
        (size * (ccx - r_in), size * (ccy - r_in), size * (ccx + r_in), size * (ccy + r_in)),
        outline=DARK,
        width=max(1, int(round(0.012 * scale * size))),
    )
    # علامة داخل النقدية: خطّان
    bar_h = 0.019 * scale
    for y in (coin_cy - 0.026, coin_cy + 0.007):
        _rounded(draw, box(coin_cx - 0.038, y, coin_cx + 0.038, y + bar_h), bar_h / 2, size, DARK)

    # ---- سهم السداد أسفل الدفتر ----
    _poly(
        draw,
        pts([(0.325, 0.705), (0.565, 0.705), (0.565, 0.6725), (0.675, 0.7375), (0.565, 0.8025), (0.565, 0.770), (0.325, 0.770)]),
        size,
        GOLD,
    )


def render(size: int, *, maskable: bool) -> Image.Image:
    """يُنتج أيقونة ممتلئة الحافة بالحجم المطلوب."""
    big = size * SS
    img = background(size).resize((big, big), Image.BILINEAR).convert("RGBA")
    scale = 0.78 if maskable else 1.0

    # طبقة الظل: ظلّ داكن يُبنى من قناع الشعار نفسه (لا نسخة ملوّنة) ثم يُطمس
    silhouette = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_mark(big, scale=scale, draw=ImageDraw.Draw(silhouette, "RGBA"))
    mask = silhouette.getchannel("A").point(lambda a: int(a * 0.45))
    shadow = Image.new("RGBA", (big, big), (4, 28, 22, 255))
    shadow.putalpha(mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=big * 0.011))
    # إزاحة بسيطة للأسفل تعطي عمقًا
    img = Image.alpha_composite(img, ImageChops.offset(shadow, 0, int(big * 0.008)))

    # الشعار نفسه فوق الظل
    draw_mark(big, scale=scale, draw=ImageDraw.Draw(img, "RGBA"))
    return img.convert("RGB").resize((size, size), Image.LANCZOS).convert("RGBA")


def render_rgb(size: int, *, maskable: bool) -> Image.Image:
    return render(size, maskable=maskable).convert("RGB")


def favicon_svg(size: int = 100) -> str:
    """
    نفس الرسم بصيغة SVG (لأيقونة تبويب المتصفح) — من الإحداثيات نفسها،
    فلا تختلف أيقونة التبويب عن أيقونة التطبيق المثبّت.
    """
    u = size / 1.0

    def p(x: float, y: float) -> str:
        return f"{x * u:.2f},{y * u:.2f}"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#128c64"/>
      <stop offset="1" stop-color="#083428"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.16" r="0.72">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{size}" height="{size}" fill="url(#bg)"/>
  <rect width="{size}" height="{size}" fill="url(#glow)"/>
  <polygon points="{p(0.215, 0.345)} {p(0.487, 0.308)} {p(0.487, 0.642)} {p(0.215, 0.679)}" fill="#ffffff"/>
  <polygon points="{p(0.513, 0.308)} {p(0.785, 0.345)} {p(0.785, 0.679)} {p(0.513, 0.642)}" fill="#e9f6f0"/>
  <rect x="{0.478 * u:.2f}" y="{0.296 * u:.2f}" width="{0.044 * u:.2f}" height="{0.358 * u:.2f}" rx="{0.014 * u:.2f}" fill="#cee8dc"/>
  <rect x="{0.268 * u:.2f}" y="{0.412 * u:.2f}" width="{0.162 * u:.2f}" height="{0.028 * u:.2f}" rx="{0.014 * u:.2f}" fill="#0f7a5a"/>
  <rect x="{0.268 * u:.2f}" y="{0.507 * u:.2f}" width="{0.162 * u:.2f}" height="{0.028 * u:.2f}" rx="{0.014 * u:.2f}" fill="#0f7a5a"/>
  <rect x="{0.570 * u:.2f}" y="{0.412 * u:.2f}" width="{0.162 * u:.2f}" height="{0.028 * u:.2f}" rx="{0.014 * u:.2f}" fill="#0f7a5a"/>
  <rect x="{0.570 * u:.2f}" y="{0.507 * u:.2f}" width="{0.162 * u:.2f}" height="{0.028 * u:.2f}" rx="{0.014 * u:.2f}" fill="#0f7a5a"/>
  <polygon points="{p(0.325, 0.705)} {p(0.565, 0.705)} {p(0.565, 0.6725)} {p(0.675, 0.7375)} {p(0.565, 0.8025)} {p(0.565, 0.770)} {p(0.325, 0.770)}" fill="#e8aa34"/>
  <circle cx="{0.685 * u:.2f}" cy="{0.282 * u:.2f}" r="{0.108 * u:.2f}" fill="#e8aa34"/>
  <ellipse cx="{0.685 * u:.2f}" cy="{0.226 * u:.2f}" rx="{0.054 * u:.2f}" ry="{0.028 * u:.2f}" fill="#fad070"/>
  <circle cx="{0.685 * u:.2f}" cy="{0.282 * u:.2f}" r="{0.0756 * u:.2f}" fill="none" stroke="#0a3d2f" stroke-width="{0.012 * u:.2f}"/>
  <rect x="{0.647 * u:.2f}" y="{0.256 * u:.2f}" width="{0.076 * u:.2f}" height="{0.019 * u:.2f}" rx="{0.0095 * u:.2f}" fill="#0a3d2f"/>
  <rect x="{0.647 * u:.2f}" y="{0.289 * u:.2f}" width="{0.076 * u:.2f}" height="{0.019 * u:.2f}" rx="{0.0095 * u:.2f}" fill="#0a3d2f"/>
</svg>
"""


def is_whitish(rgb: tuple[int, int, int]) -> bool:
    """هل اللون أقرب للأبيض/الرمادي؟ (الحواف البيضاء السابقة كانت هكذا)"""
    r, g, b = rgb
    return min(r, g, b) > 200 and (max(rgb) - min(rgb)) < 26


def verify_icon(path: Path, size: int, *, maskable: bool) -> list[str]:
    """
    يتحقق من شرطين يمنعان عودة المشكلة:
      1) الإطار الخارجي كله من الخلفية الخضراء (بلا حواف بيضاء ولا شفافية).
      2) في maskable: أفتح بقعة في الشعار (الصفحات البيضاء) تبقى داخل دائرة الأمان.
    """
    problems: list[str] = []
    im = Image.open(path).convert("RGB")
    if im.size != (size, size):
        problems.append(f"المقاس {im.size} بدل ({size}, {size})")

    w, h = im.size
    frame = 2
    for x in range(0, w, max(1, w // 24)):
        for y in list(range(0, frame)) + list(range(h - frame, h)):
            if is_whitish(im.getpixel((x, y))):
                problems.append(f"بقعة فاتحة في الإطار العلوي/السفلي عند ({x}, {y})")
    for y in range(0, h, max(1, h // 24)):
        for x in list(range(0, frame)) + list(range(w - frame, w)):
            if is_whitish(im.getpixel((x, y))):
                problems.append(f"بقعة فاتحة في الإطار الجانبي عند ({x}, {y})")

    if maskable:
        # أفتح نقطة في الشعار يجب أن تكون داخل دائرة الأمان (قطرها 80٪ من اللوحة)
        cx = cy = (w - 1) / 2
        safe = 0.40 * w
        light: tuple[int, int, int] | None = None
        for x in range(0, w, 4):
            for y in range(0, h, 4):
                px = im.getpixel((x, y))
                if is_whitish(px) and (light is None or sum(px) >= sum(light)):
                    light = px
                    if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 > safe:
                        problems.append(f"الشعار يتجاوز دائرة الأمان عند ({x}, {y})")
                        return problems
    return problems


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)

    targets: list[tuple[Path, int, bool]] = [
        (ICONS / "icon-192.png", 192, False),
        (ICONS / "icon-512.png", 512, False),
        (ICONS / "icon-1024.png", 1024, False),
        (ICONS / "maskable-192.png", 192, True),
        (ICONS / "maskable-512.png", 512, True),
        (PUBLIC / "apple-touch-icon.png", 180, False),
    ]

    failures: list[str] = []
    for path, size, maskable in targets:
        render(size, maskable=maskable).save(path, "PNG", optimize=True)
        label = f"{size}×{size}{' — maskable' if maskable else ''}"
        problems = verify_icon(path, size, maskable=maskable)
        if problems:
            failures.append(f"{path.name}: " + "؛ ".join(problems[:3]))
            print(f"✗ {path.relative_to(ROOT)}  ({label}) — {problems[0]}")
        else:
            print(f"✓ {path.relative_to(ROOT)}  ({label})")

    # favicon.ico متعدّد المقاسات (16/32/48) — يظهر في تبويب المتصفح
    ico_sizes = [16, 32, 48]
    frames = [render_rgb(s, maskable=False) for s in ico_sizes]
    frames[-1].save(PUBLIC / "favicon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])
    print(f"✓ public/favicon.ico  ({', '.join(str(s) for s in ico_sizes)})")

    # أيقونة تبويب المتصفح: نفس الرسم (SVG) — بلا حواف شفافة
    (PUBLIC / "favicon.svg").write_text(favicon_svg(), encoding="utf-8")
    print("✓ public/favicon.svg  (نفس الرسم — بلا حواف)")

    if failures:
        raise SystemExit("فشل التحقق:\n  - " + "\n  - ".join(failures))
    print("\nالتحقق ناجح: كل الأيقونات ممتلئة الحافة بلا حواف بيضاء، والنسخ maskable داخل دائرة الأمان.")


if __name__ == "__main__":
    main()
