#!/usr/bin/env python3
"""写真のEXIF(撮影日時)を読み込み、月別カレンダー形式のHTMLを生成するスクリプト.

指定ディレクトリ内の写真をスキャンし、EXIF の DateTimeOriginal
(なければ DateTime / ファイルの更新日時)を撮影日として扱い、
月ごとのカレンダーHTMLと、それらをまとめる index.html を出力します。

使い方:
    python exif_calendar.py <写真フォルダ> -o <出力フォルダ>

例:
    python exif_calendar.py ~/Pictures -o ./calendar_out
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import html
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, ExifTags
except ImportError:  # pragma: no cover
    sys.exit("Pillow が必要です。`pip install Pillow` を実行してください。")

# HEIC/HEIF を読めるようにする(任意)。未インストールでも他形式は動作する。
try:
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()
    _HEIC_OK = True
except ImportError:  # pragma: no cover
    _HEIC_OK = False


# 対応する拡張子
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".gif", ".bmp"}
if _HEIC_OK:
    IMAGE_EXTENSIONS |= {".heic", ".heif"}

# EXIF タグ名 -> ID の逆引き
_EXIF_TAG_IDS = {name: tag_id for tag_id, name in ExifTags.TAGS.items()}
_DATETIME_ORIGINAL = _EXIF_TAG_IDS.get("DateTimeOriginal")
_DATETIME_DIGITIZED = _EXIF_TAG_IDS.get("DateTimeDigitized")
_DATETIME = _EXIF_TAG_IDS.get("DateTime")


@dataclass
class Photo:
    """1枚の写真の情報."""

    source: Path
    taken: dt.datetime
    thumb_name: str  # 出力先のサムネイルファイル名
    used_exif: bool  # EXIF から日時を取れたか(False はファイル更新日時)


def parse_exif_datetime(value: str) -> dt.datetime | None:
    """EXIF の日時文字列 ("YYYY:MM:DD HH:MM:SS") を datetime に変換する."""
    if not value:
        return None
    value = value.strip().split(".")[0]  # サブ秒があれば落とす
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y:%m:%d %H:%M"):
        try:
            return dt.datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def read_taken_datetime(path: Path) -> tuple[dt.datetime, bool]:
    """写真の撮影日時と、それが EXIF 由来かどうかを返す.

    EXIF が読めない/存在しない場合はファイルの更新日時を使う。
    """
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            # DateTimeOriginal は IFD (Exif サブIFD) 側にあることが多い
            candidates: list[str] = []
            try:
                exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
            except Exception:
                exif_ifd = {}
            for tag_id in (_DATETIME_ORIGINAL, _DATETIME_DIGITIZED):
                if tag_id and tag_id in exif_ifd:
                    candidates.append(str(exif_ifd[tag_id]))
            if _DATETIME and _DATETIME in exif:
                candidates.append(str(exif[_DATETIME]))
            for raw in candidates:
                parsed = parse_exif_datetime(raw)
                if parsed:
                    return parsed, True
    except Exception:
        # 壊れた画像などはファイル日時にフォールバック
        pass

    mtime = dt.datetime.fromtimestamp(path.stat().st_mtime)
    return mtime, False


def collect_photos(input_dir: Path, recursive: bool) -> list[Path]:
    """入力フォルダから対応画像のパス一覧を集める."""
    globber = input_dir.rglob("*") if recursive else input_dir.glob("*")
    files = [
        p
        for p in globber
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return sorted(files)


def make_thumbnail(src: Path, dest: Path, size: int) -> bool:
    """サムネイルを生成して dest に保存する。成功したら True."""
    try:
        with Image.open(src) as img:
            img = img.convert("RGB")
            img.thumbnail((size, size))
            img.save(dest, "JPEG", quality=85)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! サムネイル生成失敗: {src.name} ({exc})", file=sys.stderr)
        return False


def build_photos(
    files: list[Path], thumbs_dir: Path, thumb_size: int
) -> list[Photo]:
    """各写真のサムネイルを作りつつ Photo リストを構築する."""
    photos: list[Photo] = []
    for index, src in enumerate(files):
        taken, used_exif = read_taken_datetime(src)
        thumb_name = f"thumb_{index:05d}.jpg"
        if not make_thumbnail(src, thumbs_dir / thumb_name, thumb_size):
            continue
        photos.append(
            Photo(source=src, taken=taken, thumb_name=thumb_name, used_exif=used_exif)
        )
    return photos


# ---------------------------------------------------------------------------
# HTML 生成
# ---------------------------------------------------------------------------

_WEEKDAY_JA = ["月", "火", "水", "木", "金", "土", "日"]

_CSS = """
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
  margin: 0; padding: 24px; background: #f4f5f7; color: #1f2933;
}
h1 { font-size: 1.5rem; margin: 0 0 16px; }
.nav { margin: 0 0 24px; }
.nav a {
  display: inline-block; margin: 0 8px 8px 0; padding: 6px 12px;
  background: #fff; border: 1px solid #d2d6dc; border-radius: 6px;
  color: #1f2933; text-decoration: none; font-size: 0.9rem;
}
.nav a:hover { background: #e8eaed; }
table.calendar { border-collapse: collapse; width: 100%; max-width: 1100px; background: #fff; }
table.calendar th, table.calendar td {
  border: 1px solid #e1e4e8; vertical-align: top;
}
table.calendar th {
  background: #334155; color: #fff; padding: 8px; font-weight: 600; font-size: 0.85rem;
}
table.calendar th.sat { background: #2563eb; }
table.calendar th.sun { background: #dc2626; }
table.calendar td { height: 120px; width: 14.28%; padding: 4px; }
td.empty { background: #fafbfc; }
.daynum { font-size: 0.8rem; color: #52606d; font-weight: 600; }
td.sat .daynum { color: #2563eb; }
td.sun .daynum { color: #dc2626; }
.thumbs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.thumbs img {
  width: 40px; height: 40px; object-fit: cover; border-radius: 4px;
  border: 1px solid #d2d6dc; cursor: pointer;
}
.count { font-size: 0.7rem; color: #7b8794; margin-top: 2px; }
footer { margin-top: 24px; color: #7b8794; font-size: 0.8rem; }
/* ライトボックス */
#lightbox {
  display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85);
  align-items: center; justify-content: center; z-index: 100; cursor: zoom-out;
}
#lightbox img { max-width: 92vw; max-height: 92vh; border-radius: 6px; }
"""

_LIGHTBOX_JS = """
<div id="lightbox" onclick="this.style.display='none'"><img id="lightbox-img" alt=""></div>
<script>
document.addEventListener('click', function (e) {
  if (e.target.tagName === 'IMG' && e.target.closest('.thumbs')) {
    var box = document.getElementById('lightbox');
    document.getElementById('lightbox-img').src = e.target.dataset.full || e.target.src;
    box.style.display = 'flex';
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') document.getElementById('lightbox').style.display = 'none';
});
</script>
"""


def _page(title: str, body: str, nav: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{_CSS}</style>
</head>
<body>
<h1>{html.escape(title)}</h1>
{nav}
{body}
{_LIGHTBOX_JS}
<footer>写真のEXIF撮影日時から自動生成 · {dt.date.today().isoformat()}</footer>
</body>
</html>
"""


def _nav_html(months: list[tuple[int, int]], current: tuple[int, int] | None) -> str:
    links = ['<a href="index.html">← 一覧</a>']
    for year, month in months:
        label = f"{year}年{month}月"
        target = f"{year:04d}-{month:02d}.html"
        if (year, month) == current:
            links.append(f"<a href=\"{target}\" style=\"background:#334155;color:#fff\">{label}</a>")
        else:
            links.append(f'<a href="{target}">{label}</a>')
    return f'<div class="nav">{"".join(links)}</div>'


def render_month(
    year: int,
    month: int,
    day_photos: dict[int, list[Photo]],
    months: list[tuple[int, int]],
    thumbs_rel: str,
) -> str:
    """1か月分のカレンダーHTMLを生成する(週の始まりは月曜)."""
    cal = calendar.Calendar(firstweekday=0)  # 0 = 月曜
    header_cells = ""
    for i, wd in enumerate(_WEEKDAY_JA):
        cls = "sat" if i == 5 else "sun" if i == 6 else ""
        header_cells += f'<th class="{cls}">{wd}</th>'

    rows = ""
    for week in cal.monthdayscalendar(year, month):
        cells = ""
        for i, day in enumerate(week):
            if day == 0:
                cells += '<td class="empty"></td>'
                continue
            cls = "sat" if i == 5 else "sun" if i == 6 else ""
            photos = day_photos.get(day, [])
            thumbs = ""
            for p in photos:
                src = f"{thumbs_rel}/{p.thumb_name}"
                thumbs += f'<img src="{src}" data-full="{src}" alt="{html.escape(p.source.name)}" title="{html.escape(p.source.name)}">'
            count = f'<div class="count">{len(photos)}枚</div>' if photos else ""
            cells += (
                f'<td class="{cls}"><span class="daynum">{day}</span>'
                f'<div class="thumbs">{thumbs}</div>{count}</td>'
            )
        rows += f"<tr>{cells}</tr>"

    body = (
        f'<table class="calendar"><thead><tr>{header_cells}</tr></thead>'
        f"<tbody>{rows}</tbody></table>"
    )
    title = f"{year}年{month}月のフォトカレンダー"
    return _page(title, body, _nav_html(months, (year, month)))


def render_index(
    months: list[tuple[int, int]],
    month_counts: dict[tuple[int, int], int],
    total: int,
    without_exif: int,
) -> str:
    items = ""
    for year, month in months:
        n = month_counts[(year, month)]
        target = f"{year:04d}-{month:02d}.html"
        items += (
            f'<a href="{target}">{year}年{month}月'
            f'<span style="color:#7b8794"> ({n}枚)</span></a>'
        )
    note = ""
    if without_exif:
        note = (
            f'<p style="color:#7b8794">※ {without_exif} 枚は EXIF 撮影日時が無く、'
            f"ファイル更新日時を使用しました。</p>"
        )
    body = (
        f"<p>合計 {total} 枚の写真を {len(months)} か月に分類しました。</p>"
        f"{note}"
        f'<div class="nav">{items}</div>'
    )
    return _page("フォトカレンダー 一覧", body, "")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def generate(input_dir: Path, output_dir: Path, thumb_size: int, recursive: bool) -> int:
    if not input_dir.is_dir():
        print(f"入力フォルダが見つかりません: {input_dir}", file=sys.stderr)
        return 1

    files = collect_photos(input_dir, recursive)
    if not files:
        print(f"対応する画像が見つかりませんでした: {input_dir}", file=sys.stderr)
        return 1
    print(f"{len(files)} 枚の画像を検出しました。")

    thumbs_dir = output_dir / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    photos = build_photos(files, thumbs_dir, thumb_size)
    if not photos:
        print("サムネイルを生成できた画像がありませんでした。", file=sys.stderr)
        return 1

    # 年月 -> 日 -> 写真 に振り分け
    grouped: dict[tuple[int, int], dict[int, list[Photo]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for p in photos:
        grouped[(p.taken.year, p.taken.month)][p.taken.day].append(p)

    months = sorted(grouped.keys())
    month_counts = {ym: sum(len(v) for v in days.values()) for ym, days in grouped.items()}
    without_exif = sum(1 for p in photos if not p.used_exif)

    # 各月ページ
    for (year, month), day_photos in grouped.items():
        page = render_month(year, month, day_photos, months, "thumbs")
        (output_dir / f"{year:04d}-{month:02d}.html").write_text(page, encoding="utf-8")

    # index
    index = render_index(months, month_counts, len(photos), without_exif)
    (output_dir / "index.html").write_text(index, encoding="utf-8")

    print(f"完了: {output_dir / 'index.html'} を開いてください。")
    print(f"  月数: {len(months)} / 写真: {len(photos)} 枚")
    if without_exif:
        print(f"  EXIF無し(ファイル日時使用): {without_exif} 枚")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="写真のEXIF撮影日時から月別カレンダーHTMLを生成します。"
    )
    parser.add_argument("input", type=Path, help="写真が入ったフォルダ")
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("calendar_out"),
        help="出力フォルダ (デフォルト: ./calendar_out)",
    )
    parser.add_argument(
        "-s", "--thumb-size", type=int, default=200,
        help="サムネイルの最大辺サイズ px (デフォルト: 200)",
    )
    parser.add_argument(
        "-r", "--recursive", action="store_true",
        help="サブフォルダも再帰的に探索する",
    )
    parser.add_argument(
        "--clean", action="store_true",
        help="出力フォルダを事前に削除してから生成する",
    )
    args = parser.parse_args(argv)

    if args.clean and args.output.exists():
        shutil.rmtree(args.output)

    return generate(args.input, args.output, args.thumb_size, args.recursive)


if __name__ == "__main__":
    raise SystemExit(main())
