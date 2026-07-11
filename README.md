# 📷 photo-exif-calendar

写真の EXIF(撮影日時)から、**撮影日ごとに並べた月別カレンダー**を自動生成します。
iPhone のブラウザから写真を選ぶだけで使える **Web アプリ版** と、フォルダを一括処理する **Python CLI 版** の2種類があります。

## 🌐 Web アプリ版(iPhone / スマホ向け・おすすめ)

ブラウザで開き、写真を選ぶだけでカレンダーが完成します。

- 📱 iPhone の Safari で「写真を選ぶ」→ フォトライブラリから複数選択
- 🔒 **写真は端末内だけで処理され、サーバーには一切送信されません**(プライバシー安全)
- 🗓️ 撮影日ごとにサムネイルを配置。タップで拡大表示
- ⬇️ 「HTMLで保存」で自己完結の HTML を書き出して共有可能
- 🌙 ダークモード対応・オフライン動作

### 公開 URL

GitHub Pages にデプロイすると、以下の URL で誰でも(リンクを知っている人が)開けます:

```
https://Maruko27o.github.io/photo-exif-calendar/
```

> URL を開くだけで使えるので、共有したい相手にはリンクを送るだけで OK です。
> 写真は各自の端末内で処理されるため、他人の写真がサーバーに集まることはありません。

### ローカルで試す

```bash
# このフォルダで簡易サーバーを起動(file:// でも動きますが http 推奨)
python3 -m http.server 8000
# → http://localhost:8000 を開く
```

### 構成ファイル

| ファイル | 役割 |
|---------|------|
| `index.html` | 画面 |
| `style.css` | スタイル(モバイル最適化・ダークモード) |
| `app.js` | EXIF 解析・カレンダー生成(すべてブラウザ内で完結) |

---

## 🖥️ Python CLI 版

フォルダ内の写真を一括処理して、静的な HTML カレンダーを出力します。

```bash
pip install -r requirements.txt
python exif_calendar.py <写真フォルダ> -o calendar_out -r
# → calendar_out/index.html を開く
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `input` | 写真フォルダ(必須) | - |
| `-o`, `--output` | 出力フォルダ | `./calendar_out` |
| `-s`, `--thumb-size` | サムネイル最大辺(px) | `200` |
| `-r`, `--recursive` | サブフォルダも探索 | オフ |
| `--clean` | 出力先を作り直す | オフ |

`pillow-heif` を入れると iPhone の HEIC/HEIF も読み込めます。

---

## 仕組み

1. 各画像の EXIF から `DateTimeOriginal`(撮影日時)を読み取り(無ければファイル更新日時)
2. サムネイルを生成
3. 年月 → 日 ごとに振り分けてカレンダーを描画

## 対応フォーマット

`.jpg .jpeg .png .tif .tiff .webp .gif .bmp`（CLI 版は `pillow-heif` で `.heic .heif` も対応）
Web アプリ版は iPhone がアップロード時に HEIC を JPEG へ自動変換するため、そのまま扱えます。

## ライセンス

MIT
