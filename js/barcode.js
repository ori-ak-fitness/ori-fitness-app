/* ===================================================================
   barcode.js — סריקת ברקוד של מוצר מזון והוספתו ליומן התזונה.

   הזרימה:
     1. נפתחת המצלמה במסך מלא עם מסגרת כיוון.
     2. הברקוד מזוהה — עדיפות ל-BarcodeDetector המובנה בדפדפן, ואם
        אינו קיים (אייפון, דפדפנים ישנים) נטענת ספריית ZXing מ-CDN.
     3. המוצר נשלף מ-Open Food Facts — מאגר פתוח, בלי מפתח ובלי עלות.
     4. מוצג המוצר עם ערכים ל-100 גרם, המשתמש בוחר כמות, והמאקרו
        מחושב יחסית ונשמר כארוחה רגילה.

   הכל דורש HTTPS (או localhost) בגלל גישה למצלמה — GitHub Pages עונה
   על זה. אם אין מצלמה או שההרשאה נדחתה, יש הזנה ידנית של הברקוד.
   =================================================================== */

import * as db from './db.js';
import { $, el, toast, guard, num, fmtNum, openSheet, closeSheet } from './ui.js';

const OFF_API = 'https://world.openfoodfacts.org/api/v2/product/';
const ZXING_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/+esm';

let onAdded = null;   // רענון מסך התזונה אחרי הוספה
let getDate = null;   // התאריך שמוצג כרגע במסך התזונה

/* ---------- שליפת מוצר ---------- */

/** @returns {Promise<object|null>} פרטי המוצר, או null אם לא נמצא */
async function fetchProduct(code) {
  const fields = [
    'product_name', 'product_name_he', 'generic_name', 'brands', 'quantity',
    'nutriments', 'image_small_url',
  ].join(',');

  const res = await fetch(`${OFF_API}${encodeURIComponent(code)}.json?fields=${fields}`);
  if (!res.ok) throw new Error('שגיאת רשת');
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const n = p.nutriments || {};
  // Open Food Facts מחזיר קילו-קלוריות ישירות, ואם לא — קילו-ג'אול להמרה
  const kcal100 = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);

  return {
    code,
    name: p.product_name_he || p.product_name || p.generic_name || '',
    brand: (p.brands || '').split(',')[0].trim(),
    image: p.image_small_url || null,
    per100: {
      calories: kcal100 != null ? Math.round(kcal100) : null,
      protein: n.proteins_100g ?? null,
      carbs: n.carbohydrates_100g ?? null,
      fat: n.fat_100g ?? null,
    },
  };
}

/* ---------- מסך אישור והוספה ---------- */

function openProductSheet(product) {
  const per = product.per100;

  const amount = el('input', {
    type: 'number', inputmode: 'decimal', min: '1', value: '100', autocomplete: 'off',
  });

  const preview = el('div', { class: 'bc-preview' });

  function calc() {
    const grams = num(amount.value, 0);
    const f = grams / 100;
    return {
      grams,
      calories: per.calories != null ? Math.round(per.calories * f) : 0,
      protein: per.protein != null ? +(per.protein * f).toFixed(1) : 0,
      carbs: per.carbs != null ? +(per.carbs * f).toFixed(1) : 0,
      fat: per.fat != null ? +(per.fat * f).toFixed(1) : 0,
    };
  }

  function renderPreview() {
    const c = calc();
    preview.replaceChildren(
      el('div', { class: 'bc-kcal' }, el('b', {}, fmtNum(c.calories)), el('span', {}, 'קק"ל')),
      el('div', { class: 'bc-macros' },
        el('span', {}, `🥩 ${fmtNum(c.protein)}ג'`),
        el('span', {}, `🍞 ${fmtNum(c.carbs)}ג'`),
        el('span', {}, `🥑 ${fmtNum(c.fat)}ג'`)),
    );
  }
  amount.addEventListener('input', renderPreview);
  renderPreview();

  const save = guard(async () => {
    const c = calc();
    if (c.grams <= 0) { toast('הזן כמות תקינה', 'err'); return; }
    if (!per.calories) { toast('למוצר הזה אין נתוני קלוריות במאגר', 'err'); return; }

    await db.put(db.STORES.meals, {
      id: db.uid(),
      date: getDate ? getDate() : new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
      name: [product.brand, product.name].filter(Boolean).join(' — ') || 'מוצר סרוק',
      calories: c.calories,
      protein: c.protein, carbs: c.carbs, fat: c.fat,
      details: `${fmtNum(c.grams)} גרם · ברקוד ${product.code}`,
      photo: null, thumb: null,
    });
    closeSheet();
    await onAdded?.();
    toast('נוסף ליומן ✓', 'ok');
  });

  const title = [product.brand, product.name].filter(Boolean).join(' — ') || 'מוצר';

  const body = el('div', {},
    el('div', { class: 'bc-head' },
      ...(product.image ? [el('img', { src: product.image, alt: '', class: 'bc-img' })] : []),
      el('div', {},
        el('b', { class: 'bc-name' }, title),
        el('div', { class: 'muted', style: 'font-size:.82rem' },
          per.calories != null
            ? `${fmtNum(per.calories)} קק"ל ל-100 גרם`
            : 'אין נתוני קלוריות למוצר הזה')),
    ),
    el('div', { class: 'field' }, el('label', {}, 'כמה גרם אכלת?'), amount),
    preview,
    el('button', { class: 'btn btn-primary btn-block', onclick: save }, 'הוסף ליומן'),
  );

  openSheet('נמצא מוצר', body);
  setTimeout(() => { amount.focus(); amount.select(); }, 120);
}

/* ---------- הזנה ידנית של הברקוד ---------- */

function openManualSheet(message) {
  const input = el('input', {
    type: 'text', inputmode: 'numeric', placeholder: '7290000000000', autocomplete: 'off',
  });

  const go = guard(async () => {
    const code = input.value.replace(/\D/g, '');
    if (code.length < 8) { toast('ברקוד לא תקין', 'err'); return; }
    await lookupAndShow(code);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      message || 'הקלד את המספר שמתחת לברקוד על האריזה.'),
    el('div', { class: 'field' }, el('label', {}, 'מספר ברקוד'), input),
    el('button', { class: 'btn btn-primary btn-block', onclick: go }, 'חפש מוצר'),
  );

  openSheet('הזנת ברקוד', body);
  setTimeout(() => input.focus(), 120);
}

/** משותף לסריקה ולהזנה ידנית */
async function lookupAndShow(code) {
  toast('מחפש מוצר…');
  let product;
  try {
    product = await fetchProduct(code);
  } catch (err) {
    console.warn('[Ori Fitness] שליפת מוצר נכשלה:', err);
    toast('אין חיבור למאגר המוצרים', 'err');
    return;
  }
  if (!product) {
    openManualSheet(`הברקוד ${code} לא נמצא במאגר. אפשר לנסות מספר אחר, או להוסיף ידנית דרך "חדש".`);
    return;
  }
  openProductSheet(product);
}

/* ---------- המצלמה ---------- */

let stream = null;
let stopLoop = null;

function closeCamera() {
  stopLoop?.();
  stopLoop = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  document.querySelector('#bcScanner')?.remove();
  document.body.classList.remove('bc-open');
}

/** זיהוי עם ה-API המובנה בדפדפן (אנדרואיד/כרום) */
async function scanWithNative(video, onCode) {
  const detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
  });
  let alive = true;
  stopLoop = () => { alive = false; };

  const tick = async () => {
    if (!alive) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length && codes[0].rawValue) { onCode(codes[0].rawValue); return; }
    } catch { /* פריים לא תקין — ממשיכים */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** גיבוי לדפדפנים בלי BarcodeDetector (אייפון) */
async function scanWithZXing(video, onCode) {
  const { BrowserMultiFormatReader } = await import(ZXING_CDN);
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result) onCode(result.getText());
  });
  stopLoop = () => { try { controls.stop(); } catch { /* כבר נעצר */ } };
}

export async function openScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    openManualSheet('הדפדפן הזה לא תומך במצלמה. אפשר להקליד את הברקוד ידנית.');
    return;
  }

  const video = el('video', { playsinline: '', muted: '', autoplay: '' });
  const overlay = el('div', { id: 'bcScanner', class: 'bc-scanner' },
    video,
    el('div', { class: 'bc-frame' }),
    el('p', { class: 'bc-hint' }, 'כוון את הברקוד למסגרת'),
    el('div', { class: 'bc-actions' },
      el('button', { class: 'btn btn-ghost', onclick: () => { closeCamera(); openManualSheet(); } }, 'הקלדה ידנית'),
      el('button', { class: 'btn btn-secondary', onclick: () => closeCamera() }, 'סגור'),
    ),
  );
  document.body.append(overlay);
  document.body.classList.add('bc-open');

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    console.warn('[Ori Fitness] מצלמה נדחתה:', err);
    closeCamera();
    openManualSheet('אין גישה למצלמה. אפשר לאשר בהגדרות הדפדפן, או להקליד את הברקוד.');
    return;
  }

  video.srcObject = stream;
  try { await video.play(); } catch { /* חלק מהדפדפנים מנגנים לבד */ }

  // נעילה: בלעדיה זיהוי חוזר של אותו ברקוד היה פותח כמה גיליונות
  let handled = false;
  const onCode = (code) => {
    if (handled) return;
    handled = true;
    try { navigator.vibrate?.(60); } catch { /* לא נתמך */ }
    closeCamera();
    lookupAndShow(code);
  };

  try {
    if ('BarcodeDetector' in window) await scanWithNative(video, onCode);
    else await scanWithZXing(video, onCode);
  } catch (err) {
    console.warn('[Ori Fitness] זיהוי ברקוד נכשל:', err);
    closeCamera();
    openManualSheet('לא הצלחנו להפעיל את הסורק. אפשר להקליד את הברקוד.');
  }
}

export function initBarcode({ onAdded: cb, currentDate } = {}) {
  onAdded = cb;
  getDate = currentDate;
  $('#scanBarcodeBtn')?.addEventListener('click', guard(openScanner));
}
