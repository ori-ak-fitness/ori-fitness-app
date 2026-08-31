/* ===================================================================
   ui.js — כלי עזר משותפים: טוסטים, גיליון תחתון, תאריכים,
   עיבוד תמונות, קונפטי, ומעבר אוטומטי בין שדות מספריים.
   =================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * עוטף מטפל אסינכרוני כך שהקשה כפולה מהירה לא תפעיל אותו פעמיים
 * (למשל: שמירה שיוצרת שתי רשומות במקום אחת).
 */
export function guard(handler) {
  let running = false;
  return async function (...args) {
    if (running) return;
    running = true;
    const btn = this instanceof HTMLButtonElement ? this : null;
    if (btn) btn.disabled = true;
    try {
      await handler.apply(this, args);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  };
}

/**
 * פותח בורר קבצים/מצלמה פעם אחת בלבד. בלי זה, הקשה כפולה במובייל
 * עלולה לפתוח את חלון הבחירה פעמיים.
 */
export function pickFileOnce(input) {
  if (input.dataset.picking === '1') return;
  input.dataset.picking = '1';
  input.click();
  setTimeout(() => { delete input.dataset.picking; }, 900);
}

/**
 * מריץ רינדור מחדש בלי לאבד את מיקום הגלילה.
 * replaceChildren מרוקן את המיכל לרגע, הגובה מתאפס, והדפדפן קופץ למעלה —
 * זה מה שגורם ל"רשמתי תרגיל וקפצתי לראש העמוד".
 */
export function keepScroll(container, fn) {
  const scroller = container?.closest?.('.sheet-body, .wizard-body') || null;
  const winY = window.scrollY;
  const boxY = scroller ? scroller.scrollTop : 0;

  fn();

  if (scroller) scroller.scrollTop = boxY;
  if (window.scrollY !== winY) window.scrollTo({ top: winY });
}

/* ---------- טוסט ---------- */

export function toast(message, kind = '', ms = 2600) {
  const host = $('#toastHost');
  const node = el('div', { class: `toast ${kind}` }, message);
  host.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }, ms);
}

/* ---------- גיליון תחתון (Bottom sheet) ---------- */

let sheetOnClose = null;

export function openSheet(title, bodyNode, { onClose } = {}) {
  $('#sheetTitle').textContent = title;
  const body = $('#sheetBody');
  body.replaceChildren(bodyNode);
  body.scrollTop = 0;
  $('#sheet').classList.remove('hidden');
  $('#sheetBackdrop').classList.remove('hidden');
  sheetOnClose = onClose || null;
}

export function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#sheetBackdrop').classList.add('hidden');
  $('#sheetBody').replaceChildren();
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (cb) cb();
}

export function initSheet() {
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet();
  });
}

/** דיאלוג אישור פשוט בתוך גיליון */
export function confirmSheet(title, message, confirmLabel = 'אישור') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };

    const body = el('div', {},
      el('p', { class: 'muted', style: 'margin-bottom:18px' }, message),
      el('button', {
        class: 'btn btn-danger btn-block',
        onclick: () => { finish(true); closeSheet(); },
      }, confirmLabel),
      el('button', {
        class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
        onclick: () => { finish(false); closeSheet(); },
      }, 'ביטול'),
    );
    openSheet(title, body, { onClose: () => finish(false) });
  });
}

/* ---------- תאריכים ---------- */

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** מפתח תאריך מקומי YYYY-MM-DD (לא UTC — כדי שלא יזוז יום) */
export function dateKey(d = new Date()) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDateKey(key, days) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** תווית קצרה לציר X בגרפים: "2026-08-02" -> "2/8" */
export function shortDate(key) {
  const d = parseDateKey(key);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function formatDateHe(key, { withYear = false } = {}) {
  const today = dateKey();
  if (key === today) return 'היום';
  if (key === shiftDateKey(today, -1)) return 'אתמול';
  if (key === shiftDateKey(today, 1)) return 'מחר';
  const d = parseDateKey(key);
  const base = `יום ${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
  return withYear ? `${base} ${d.getFullYear()}` : base;
}

/** תאריך מלא תמיד (בלי "היום"/"אתמול") — לכותרת מסך הבית */
export function formatFullDateHe(date = new Date()) {
  return `יום ${HE_DAYS[date.getDay()]}, ${date.getDate()} ב${HE_MONTHS[date.getMonth()]}`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** שניות -> MM:SS או H:MM:SS */
export function formatDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/*
 * משך קריא לסיכום: "1 שעה 12 דק'". מעגלים את סך הדקות פעם אחת ואז
 * מפצלים לשעות/דקות — לא מעגלים כל אחד בנפרד, כי זה נתן "60 דק'"
 * במקום לגלוש לשעה כשהשארית מתעגלת בדיוק ל-60 (למשל 59:40).
 */
export function formatDurationHe(totalSec) {
  const totalMin = Math.round(Math.max(0, totalSec) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h} שע' ${m} דק'`;
  if (h) return `${h} שעות`;
  return `${m || 1} דק'`;
}

/* ---------- מספרים ---------- */

export function num(value, fallback = 0) {
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('he-IL', { maximumFractionDigits: digits });
}

/*
 * שורת המאקרו שמופיעה מתחת לכל ארוחה — בתפריט הקבוע וגם ביומן.
 *
 * האמוג'י מחליף את המילה: "חלבון 39ג' · פחמימות 40ג' · שומן 20ג'" הוא
 * שורה ארוכה שנקראת כמו טקסט, ואילו שלושה סמלים ומספרים נסרקים במבט.
 * אותם סמלים בדיוק כמו בכרטיס העליון, כדי שיהיה אפשר לקשר ביניהם.
 */
export const MACRO_ICONS = { protein: '🥩', carbs: '🍞', fat: '🥑' };

export function macroLine(protein, carbs, fat) {
  const g = (v) => `${fmtNum(num(v))}ג'`;
  return `${MACRO_ICONS.protein} ${g(protein)} · ${MACRO_ICONS.carbs} ${g(carbs)} · ${MACRO_ICONS.fat} ${g(fat)}`;
}

/**
 * ספירה בעברית תקינה: 1 -> "תרגיל אחד" / "ארוחה אחת", אחרת "3 תרגילים".
 * @param {boolean} feminine  שם עצם בנקבה (ארוחה, תוכנית, תמונה)
 */
export function heCount(n, singular, plural, feminine = false) {
  if (n !== 1) return `${fmtNum(n)} ${plural}`;
  return `${singular} ${feminine ? 'אחת' : 'אחד'}`;
}

/* ---------- תמונות ---------- */

/**
 * מקטין תמונה ומחזיר Blob (JPEG) — שומר על מסד נתונים קטן.
 * @returns {Promise<Blob>}
 */
export function resizeImage(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('כשל בעיבוד התמונה')),
        'image/jpeg', quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('לא ניתן לקרוא את התמונה')); };
    img.src = url;
  });
}

const objectUrls = new Set();

/** יוצר URL לתצוגת Blob ושומר אותו לשחרור מאוחר יותר */
export function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

/* ---------- קונפטי ---------- */

export function confetti(host, count = 70) {
  // צבעים מהערכה הפעילה, כדי שהקונפטי יתאים גם בקרם וגם בלילה
  const s = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (s.getPropertyValue(name) || '').trim() || fallback;
  const colors = [
    pick('--accent', '#2f2a22'), pick('--accent-2', '#1d6f8f'), pick('--ok', '#1f7a4d'),
    pick('--carbs', '#9a6400'), pick('--fat', '#6d4bab'), pick('--text', '#221e18'),
  ];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const piece = el('div', { class: 'confetti' });
    piece.style.insetInlineStart = Math.random() * 100 + '%';
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    piece.style.opacity = String(0.7 + Math.random() * 0.3);
    frag.append(piece);
  }
  host.replaceChildren(frag);
  setTimeout(() => host.replaceChildren(), 4200);
}

/* ===================================================================
   מעבר אוטומטי בין שדות מספריים
   -------------------------------------------------------------------
   שתי דרכים לעבור לשדה הבא:
   1. debounce — אחרי הפסקה קצרה בהקלדה (ברירת מחדל 1000ms)
   2. מיידית — Enter / כפתור "הבא" במקלדת (enterkeyhint="next")
   =================================================================== */

export const AUTO_ADVANCE_DEFAULT_MS = 1000;

// ניתן לשינוי מההגדרות: 0 = כבוי לגמרי
let autoAdvanceMs = AUTO_ADVANCE_DEFAULT_MS;

export function setAutoAdvanceMs(ms) {
  autoAdvanceMs = Math.max(0, num(ms, AUTO_ADVANCE_DEFAULT_MS));
}

/**
 * מפעיל מעבר אוטומטי על מיכל. כל שדה עם [data-advance] משתתף בשרשרת.
 * Enter / "הבא" במקלדת עובד תמיד, גם כשהמעבר ההשהייתי כבוי.
 * @param {HTMLElement} container
 * @param {(input: HTMLInputElement) => HTMLElement|null} nextResolver
 *        פונקציה שמחזירה את השדה/האלמנט הבא, או null אם זה האחרון.
 */
export function attachAutoAdvance(container, nextResolver) {
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };

  const advance = (input) => {
    cancel();
    const next = nextResolver(input);
    if (next && typeof next.focus === 'function') {
      next.focus();
      if (next.select) next.select();
    } else {
      input.blur(); // סוגר את המקלדת בסוף השרשרת
    }
  };

  container.addEventListener('input', (e) => {
    const input = e.target;
    if (!input.matches?.('[data-advance]')) return;
    cancel();
    if (autoAdvanceMs === 0) return;             // כבוי בהגדרות
    if (input.value === '') return;              // שדה ריק — לא קופצים
    if (input.dataset.noAdvance === '1') return; // אפשר לכבות נקודתית
    timer = setTimeout(() => advance(input), autoAdvanceMs);
  });

  container.addEventListener('keydown', (e) => {
    const input = e.target;
    if (!input.matches?.('[data-advance]')) return;
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      advance(input);
    }
  });

  // יציאה מהשדה מבטלת מעבר ממתין, כדי שלא "יקפוץ" אחרי שהמשתמש עזב
  container.addEventListener('focusout', cancel, true);

  return cancel;
}
