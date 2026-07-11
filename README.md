# photo-exif-calendar

写真の EXIF(撮影日時)を読み込んで、**月別カレンダー形式の HTML** を自動生成する Python スクリプトです。
指定したフォルダ内の写真を撮影日ごとに振り分け、サムネイル付きのカレンダーを作成します。

![概要](docs/screenshot.png)

## 特長

- 📅 撮影月ごとにカレンダー HTML を生成し、`index.html` から一覧できる
- 🖼️ 各日にその日撮った写真のサムネイルを表示(クリックで拡大表示)
- 🧭 EXIF の `DateTimeOriginal` を優先。無ければファイル更新日時にフォールバック
- 📱 `pillow-heif` を入れれば iPhone の HEIC/HEIF も対応
- 📦 出力は静的 HTML + JPEG サムネイルのみ。ブラウザで開くだけ

## セットアップ

```bash
pip install -r requirements.txt
```

## 使い方

```bash
python exif_calendar.py <写真フォルダ> -o <出力フォルダ>
```

### 例

```bash
# ~/Pictures をスキャンして ./calendar_out に出力
python exif_calendar.py ~/Pictures -o calendar_out

# サブフォルダも再帰的に探索し、サムネイルを大きめ(300px)に
python exif_calendar.py ~/Pictures -o calendar_out -r -s 300
```

生成後、`calendar_out/index.html` をブラウザで開いてください。

## オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `input` | 写真が入ったフォルダ(必須) | - |
| `-o`, `--output` | 出力フォルダ | `./calendar_out` |
| `-s`, `--thumb-size` | サムネイルの最大辺サイズ(px) | `200` |
| `-r`, `--recursive` | サブフォルダも再帰的に探索 | オフ |
| `--clean` | 出力フォルダを削除してから生成 | オフ |

## 対応フォーマット

`.jpg .jpeg .png .tif .tiff .webp .gif .bmp`
（`pillow-heif` インストール時は `.heic .heif` も対応）

## 仕組み

1. 入力フォルダから対応画像を収集
2. 各画像の EXIF から撮影日時を読み取り(無ければファイル更新日時)
3. サムネイルを生成
4. 年月 → 日 ごとに振り分けてカレンダー HTML を出力

## ライセンス

MIT
