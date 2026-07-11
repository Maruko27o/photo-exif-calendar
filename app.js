/* 写真EXIFカレンダー — クライアントサイド処理
 * 写真は一切サーバーに送信されず、ブラウザ内だけで処理されます。
 */

/* ===================== EXIF 解析 ===================== */

// JPEG の ArrayBuffer から撮影日時(文字列)と Orientation を取り出す。
// 取得できなければ date は null。
function getExifData(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) {
    return { date: null, orientation: 1 }; // JPEG ではない
  }
  const length = view.byteLength;
  let offset = 2;
  while (offset < length - 1) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      // APP1 セグメント。"Exif\0\0" で始まるか確認
      if (view.getUint32(offset + 4) === 0x45786966) {
        return parseExifTiff(view, offset + 10);
      }
      offset += 2 + view.getUint16(offset + 2);
    } else if ((marker & 0xff00) !== 0xff00) {
      break; // マーカーではない → 画像データ本体
    } else {
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return { date: null, orientation: 1 };
}

function parseExifTiff(view, tiffStart) {
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949; // 'II'
  const g16 = (o) => view.getUint16(o, little);
  const g32 = (o) => view.getUint32(o, little);

  if (g16(tiffStart + 2) !== 0x002a) return { date: null, orientation: 1 };

  const readIFD = (dirStart) => {
    const count = g16(dirStart);
    const tags = {};
    for (let i = 0; i < count; i++) {
      const entry = dirStart + 2 + i * 12;
      tags[g16(entry)] = {
        type: g16(entry + 2),
        count: g32(entry + 4),
        valueField: entry + 8,
      };
    }
    return tags;
  };

  const readAscii = (entry) => {
    if (!entry) return null;
    const n = entry.count;
    const dataOffset = n > 4 ? tiffStart + g32(entry.valueField) : entry.valueField;
    let s = "";
    for (let i = 0; i < n - 1; i++) {
      s += String.fromCharCode(view.getUint8(dataOffset + i));
    }
    return s.replace(/\0.*$/, "").trim();
  };

  const ifd0 = readIFD(tiffStart + g32(tiffStart + 4));

  // Orientation (0x0112) は SHORT で値が直接入る
  let orientation = 1;
  if (ifd0[0x0112]) orientation = g16(ifd0[0x0112].valueField) || 1;

  // 撮影日時: Exif SubIFD(0x8769)の DateTimeOriginal(0x9003)を最優先
  let dateStr = null;
  if (ifd0[0x8769]) {
    const exifIFD = readIFD(tiffStart + g32(ifd0[0x8769].valueField));
    dateStr =
      readAscii(exifIFD[0x9003]) || // DateTimeOriginal
      readAscii(exifIFD[0x9004]);   // DateTimeDigitized
  }
  if (!dateStr) dateStr = readAscii(ifd0[0x0132]); // DateTime

  return { date: dateStr || null, orientation };
}

// EXIF の "YYYY:MM:DD HH:MM:SS" を Date に変換
function parseExifDateString(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +(se || 0));
  return isNaN(date.getTime()) ? null : date;
}

/* ===================== カレンダー用ユーティリティ ===================== */

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

// 月曜始まりの週配列(0=空白)を返す
function monthMatrix(year, month /* 1-12 */) {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  let startWeekday = (first.getDay() + 6) % 7; // 月曜=0
  const weeks = [];
  let week = new Array(startWeekday).fill(0);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(0);
    weeks.push(week);
  }
  return weeks;
}

/* ===================== ブラウザ UI ===================== */

if (typeof document !== "undefined") {
  const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
  const EN_MONTH = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const THUMB_MAX = 240; // サムネイル最大辺(px)

  const state = {
    photos: [],           // { date, name, thumb, file, usedExif }
    grouped: new Map(),   // monthKey -> Map(day -> photos[])
    months: [],           // ["2026-05", ...]
    current: null,        // 表示中の monthKey
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    const input = $("file-input");
    input.addEventListener("change", (e) => handleFiles(e.target.files));
    $("reset-btn").addEventListener("click", resetAll);
    $("export-btn").addEventListener("click", exportHtml);
    $("poster-btn").addEventListener("click", openPoster);
    $("poster-close").addEventListener("click", closePoster);
    $("poster-print").addEventListener("click", () => window.print());
    document.querySelectorAll(".theme-btn").forEach((b) =>
      b.addEventListener("click", () => setPosterTheme(b.dataset.theme, b))
    );
    $("prev-btn").addEventListener("click", () => stepMonth(-1));
    $("next-btn").addEventListener("click", () => stepMonth(1));
    $("lightbox").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeLightbox();
    });
  });

  // ---- 画像読み込み ----
  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;

    showProgress(true);
    setProgress(0, files.length);
    let processed = 0;

    for (const file of files) {
      try {
        const info = await readPhoto(file);
        if (info) state.photos.push(info);
      } catch (_) {
        /* 壊れた画像はスキップ */
      }
      processed++;
      setProgress(processed, files.length);
      // UI をブロックしないよう小休止
      if (processed % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    showProgress(false);
    rebuild();
  }

  async function readPhoto(file) {
    // 先頭部分だけ読んで EXIF を高速に取得
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    const { date } = getExifData(head);
    const parsed = parseExifDateString(date);
    const usedExif = !!parsed;
    const taken = parsed || new Date(file.lastModified);
    const thumb = await makeThumbnail(file);
    if (!thumb) return null;
    return { date: taken, name: file.name, thumb, file, usedExif };
  }

  // <img> 経由で EXIF orientation を自動適用 → canvas に縮小描画
  function makeThumbnail(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const { naturalWidth: w0, naturalHeight: h0 } = img;
        const scale = Math.min(1, THUMB_MAX / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try {
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null); // HEIC など描画できない形式
      };
      img.src = url;
    });
  }

  // ---- グループ化 & 再描画 ----
  function rebuild() {
    const grouped = new Map();
    for (const p of state.photos) {
      const mk = monthKey(p.date);
      if (!grouped.has(mk)) grouped.set(mk, new Map());
      const days = grouped.get(mk);
      const d = p.date.getDate();
      if (!days.has(d)) days.set(d, []);
      days.get(d).push(p);
    }
    state.grouped = grouped;
    state.months = [...grouped.keys()].sort();
    if (!state.current || !grouped.has(state.current)) {
      state.current = state.months[state.months.length - 1] || null;
    }

    const has = state.photos.length > 0;
    $("empty").classList.toggle("hidden", has);
    $("result").classList.toggle("hidden", !has);
    if (!has) return;

    const withoutExif = state.photos.filter((p) => !p.usedExif).length;
    $("summary").textContent =
      `${state.photos.length}枚の写真を${state.months.length}か月に分類` +
      (withoutExif ? ` ・ うち${withoutExif}枚はEXIF無し(ファイル日時を使用)` : "");

    renderMonthChips();
    renderCalendar();
  }

  function renderMonthChips() {
    const bar = $("month-chips");
    bar.innerHTML = "";
    for (const mk of state.months) {
      const [y, m] = mk.split("-");
      const chip = document.createElement("button");
      chip.className = "chip" + (mk === state.current ? " active" : "");
      const n = countInMonth(mk);
      chip.innerHTML = `${+y}年${+m}月<small>${n}</small>`;
      chip.addEventListener("click", () => {
        state.current = mk;
        renderMonthChips();
        renderCalendar();
      });
      bar.appendChild(chip);
    }
  }

  function countInMonth(mk) {
    let n = 0;
    for (const arr of state.grouped.get(mk).values()) n += arr.length;
    return n;
  }

  function stepMonth(dir) {
    const i = state.months.indexOf(state.current);
    const ni = i + dir;
    if (ni < 0 || ni >= state.months.length) return;
    state.current = state.months[ni];
    renderMonthChips();
    renderCalendar();
    $("month-chips").querySelector(".chip.active")?.scrollIntoView({
      inline: "center", block: "nearest", behavior: "smooth",
    });
  }

  function renderCalendar() {
    const mk = state.current;
    const [y, m] = mk.split("-").map(Number);
    const days = state.grouped.get(mk);
    $("month-title").textContent = `${y}年 ${m}月`;

    const i = state.months.indexOf(mk);
    $("prev-btn").disabled = i <= 0;
    $("next-btn").disabled = i >= state.months.length - 1;

    let head = "";
    WEEKDAYS.forEach((w, idx) => {
      const cls = idx === 5 ? "sat" : idx === 6 ? "sun" : "";
      head += `<th class="${cls}">${w}</th>`;
    });

    let body = "";
    for (const week of monthMatrix(y, m)) {
      body += "<tr>";
      week.forEach((day, idx) => {
        if (day === 0) {
          body += '<td class="empty"></td>';
          return;
        }
        const cls = idx === 5 ? "sat" : idx === 6 ? "sun" : "";
        const photos = days.get(day) || [];
        let thumbs = "";
        photos.forEach((p) => {
          const gi = state.photos.indexOf(p);
          thumbs += `<img loading="lazy" src="${p.thumb}" data-idx="${gi}" alt="${escapeHtml(p.name)}">`;
        });
        const count = photos.length ? `<span class="count">${photos.length}</span>` : "";
        body += `<td class="${cls}"><span class="daynum">${day}</span>${count}<div class="thumbs">${thumbs}</div></td>`;
      });
      body += "</tr>";
    }

    $("calendar").innerHTML =
      `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    $("calendar").querySelectorAll(".thumbs img").forEach((el) => {
      el.addEventListener("click", () => openLightbox(+el.dataset.idx));
    });
  }

  // ---- ライトボックス ----
  let lightboxUrl = null;
  function openLightbox(idx) {
    const p = state.photos[idx];
    if (!p) return;
    if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
    lightboxUrl = URL.createObjectURL(p.file);
    $("lightbox-img").src = lightboxUrl;
    $("lightbox-cap").textContent =
      `${p.name} ・ ${p.date.toLocaleString("ja-JP")}` + (p.usedExif ? "" : "(ファイル日時)");
    $("lightbox").classList.add("show");
  }
  function closeLightbox() {
    $("lightbox").classList.remove("show");
    if (lightboxUrl) {
      URL.revokeObjectURL(lightboxUrl);
      lightboxUrl = null;
    }
    $("lightbox-img").removeAttribute("src");
  }

  // ---- 進捗 & リセット ----
  function showProgress(on) {
    $("progress").classList.toggle("hidden", !on);
  }
  function setProgress(done, total) {
    $("progress-bar").style.width = `${Math.round((done / total) * 100)}%`;
    $("progress-text").textContent = `読み込み中… ${done} / ${total}`;
  }
  function resetAll() {
    if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
    state.photos = [];
    state.grouped = new Map();
    state.months = [];
    state.current = null;
    $("file-input").value = "";
    rebuild();
  }

  // ---- 自己完結HTMLとして書き出し ----
  function exportHtml() {
    const doc = buildStandaloneHtml();
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `photo-calendar-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildStandaloneHtml() {
    let sections = "";
    for (const mk of state.months) {
      const [y, m] = mk.split("-").map(Number);
      const days = state.grouped.get(mk);
      let head = "";
      WEEKDAYS.forEach((w, idx) => {
        const cls = idx === 5 ? "sat" : idx === 6 ? "sun" : "";
        head += `<th class="${cls}">${w}</th>`;
      });
      let body = "";
      for (const week of monthMatrix(y, m)) {
        body += "<tr>";
        week.forEach((day, idx) => {
          if (day === 0) return (body += '<td class="empty"></td>');
          const cls = idx === 5 ? "sat" : idx === 6 ? "sun" : "";
          const photos = days.get(day) || [];
          const thumbs = photos
            .map((p) => `<img src="${p.thumb}" alt="${escapeHtml(p.name)}">`)
            .join("");
          body += `<td class="${cls}"><span class="daynum">${day}</span><div class="thumbs">${thumbs}</div></td>`;
        });
        body += "</tr>";
      }
      sections +=
        `<h2>${y}年 ${m}月</h2>` +
        `<table class="calendar"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    const css =
      "body{font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;margin:0;padding:20px;background:#f4f5f7;color:#1f2933}" +
      "h1{font-size:1.4rem}h2{margin:28px 0 8px}" +
      "table.calendar{border-collapse:collapse;width:100%;max-width:1000px;background:#fff;margin-bottom:12px}" +
      "th,td{border:1px solid #e1e4e8;vertical-align:top}th{background:#334155;color:#fff;padding:6px;font-size:.8rem}" +
      "th.sat{background:#2563eb}th.sun{background:#dc2626}td{height:96px;width:14.28%;padding:3px}" +
      "td.empty{background:#fafbfc}.daynum{font-size:.75rem;color:#52606d;font-weight:600}" +
      ".thumbs{display:flex;flex-wrap:wrap;gap:2px;margin-top:3px}.thumbs img{width:34px;height:34px;object-fit:cover;border-radius:4px}";
    return (
      `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>フォトカレンダー</title><style>${css}</style></head><body>` +
      `<h1>📷 フォトカレンダー</h1>${sections}` +
      `<p style="color:#7b8794;font-size:.8rem">写真EXIFから生成 ・ ${new Date().toLocaleDateString("ja-JP")}</p>` +
      `</body></html>`
    );
  }

  // ---- ポスター(思い出・印刷用) ----
  let posterUrls = [];

  // 決定的な擬似乱数(写真ごとに一定の傾き)
  function seeded(i) {
    const x = Math.sin(i * 12.9898 + 1.3) * 43758.5453;
    return x - Math.floor(x);
  }

  function openPoster() {
    if (!state.current) return;
    const [y, m] = state.current.split("-").map(Number);
    const days = state.grouped.get(state.current);

    const items = [];
    [...days.keys()].sort((a, b) => a - b).forEach((d) => {
      days.get(d).forEach((p) => items.push({ p, d }));
    });

    $("poster-en").textContent = `${EN_MONTH[m - 1]} ${y}`;
    $("poster-jp").textContent = `${y}年 ${m}月`;

    posterUrls.forEach((u) => URL.revokeObjectURL(u));
    posterUrls = [];

    const grid = $("poster-grid");
    grid.innerHTML = "";
    items.forEach(({ p, d }, i) => {
      const url = URL.createObjectURL(p.file);
      posterUrls.push(url);
      const fig = document.createElement("figure");
      fig.className = "pframe";
      fig.style.setProperty("--rot", `${(seeded(i) * 6 - 3).toFixed(2)}deg`);
      fig.innerHTML =
        `<div class="pph"><img src="${url}" alt=""></div>` +
        `<figcaption>${m}/${d}</figcaption>`;
      grid.appendChild(fig);
    });

    $("poster").classList.add("show");
  }

  function setPosterTheme(theme, btn) {
    const sheet = $("poster-sheet");
    sheet.className = `poster-sheet theme-${theme}`;
    document.querySelectorAll(".theme-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }

  function closePoster() {
    $("poster").classList.remove("show");
    posterUrls.forEach((u) => URL.revokeObjectURL(u));
    posterUrls = [];
    $("poster-grid").innerHTML = "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
}

/* ===================== Node テスト用エクスポート ===================== */

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getExifData, parseExifDateString, monthKey, monthMatrix };
}
