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
/*
 * גודל האריזה מגיע מ-Open Food Facts בשני אופנים: שדה מספרי מנורמל
 * (product_quantity, תמיד בגרם או מ"ל), ובנוסף מחרוזת חופשית כמו
 * "500 ml". מעדיפים את המספרי, ונופלים למחרוזת רק אם הוא חסר.
 */
function parseAmount(text) {
  const m = String(text || '').replace(',', '.').match(/([\d.]+)\s*(kg|ק"ג|l|ליטר|ml|מ"ל|מל|g|גרם|גר)?/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!isFinite(value) || value <= 0) return null;
  const unit = (m[2] || '').toLowerCase();
  // ק"ג וליטר מומרים ליחידת הבסיס, אחרת החישוב היה קטן פי אלף
  if (unit === 'kg' || unit === 'ק"ג' || unit === 'l' || unit === 'ליטר') return value * 1000;
  return value;
}

function isLiquid(product) {
  return /\b(ml|l)\b|מ"ל|ליטר/i.test(`${product.quantity || ''} ${product.product_quantity_unit || ''}`);
}

async function fetchProduct(code) {
  const fields = [
    'product_name', 'product_name_he', 'generic_name', 'brands', 'quantity',
    'product_quantity', 'product_quantity_unit', 'serving_size', 'serving_quantity',
    'nutriments', 'image_small_url',
  ].join(',');

  const res = await fetch(`${OFF_API}${encodeURIComponent(code)}.json?fields=${fields}`);
  // 404 מהמאגר פירושו "המוצר לא קיים", לא "אין רשת" — בלי ההפרדה הזו
  // כל מוצר לא מוכר היה מוצג כתקלת תקשורת
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('שגיאת רשת');
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const n = p.nutriments || {};
  // Open Food Facts מחזיר קילו-קלוריות ישירות, ואם לא — קילו-ג'אול להמרה
  const kcal100 = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);

  const liquid = isLiquid(p);

  return {
    code,
    name: p.product_name_he || p.product_name || p.generic_name || '',
    brand: (p.brands || '').split(',')[0].trim(),
    image: p.image_small_url || null,
    liquid,
    unit: liquid ? 'מ"ל' : 'גרם',
    // גודל האריזה השלמה, כדי שסריקה של בקבוק תדע לבד כמה זה בלי שאלות
    packageAmount: parseAmount(p.product_quantity) ?? parseAmount(p.quantity),
    packageLabel: (p.quantity || '').trim(),
    servingAmount: parseAmount(p.serving_quantity) ?? parseAmount(p.serving_size),
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
  const unit = product.unit;

  /*
   * ברירת המחדל היא האריזה השלמה ולא 100 גרם: מי שסורק בקבוק שתייה
   * רוצה את הקלוריות של הבקבוק, ולא צריך לדעת בעל פה כמה מ"ל יש בו.
   * 100 נשאר רק כשגודל האריזה לא קיים במאגר.
   */
  const presets = [];
  if (product.packageAmount) {
    presets.push({ label: `אריזה שלמה · ${fmtNum(product.packageAmount)} ${unit}`, value: product.packageAmount });
  }
  if (product.servingAmount && product.servingAmount !== product.packageAmount) {
    presets.push({ label: `מנה · ${fmtNum(product.servingAmount)} ${unit}`, value: product.servingAmount });
  }
  if (!presets.some((p) => p.value === 100)) {
    presets.push({ label: `100 ${unit}`, value: 100 });
  }

  const amount = el('input', {
    type: 'number', inputmode: 'decimal', min: '1',
    value: String(product.packageAmount || 100), autocomplete: 'off',
  });

  const chips = el('div', { class: 'chip-row' });
  function syncChips() {
    const cur = num(amount.value, 0);
    chips.replaceChildren(...presets.map((p) => el('button', {
      class: `chip${Math.abs(cur - p.value) < 0.01 ? ' is-on' : ''}`,
      onclick: () => { amount.value = String(p.value); renderPreview(); syncChips(); },
    }, p.label)));
  }

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
  amount.addEventListener('input', () => { renderPreview(); syncChips(); });
  renderPreview();
  syncChips();

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
      details: `${fmtNum(c.grams)} ${unit} · ברקוד ${product.code}`,
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
            ? `${fmtNum(per.calories)} קק"ל ל-100 ${unit}` +
              (product.packageLabel ? ` · אריזה: ${product.packageLabel}` : '')
            : 'אין נתוני קלוריות למוצר הזה')),
    ),
    chips,
    el('div', { class: 'field' },
      el('label', {}, product.liquid ? `כמה שתית? (${unit})` : `כמה אכלת? (${unit})`),
      amount),
    ...(product.packageAmount ? [] : [el('p', { class: 'muted', style: 'font-size:.78rem;margin:-6px 0 12px' },
      'גודל האריזה לא רשום במאגר למוצר הזה, אז צריך להזין כמות ידנית.')]),
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

/* ---------- המוצרים שלי ---------- */

/*
 * המאגר העולמי לא מכיר חלק גדול מהמוצרים בסופר הישראלי, ואי אפשר
 * לעקוף את זה. מה שכן אפשר: שהאפליקציה תלמד מוצר פעם אחת ותזכור
 * אותו לתמיד. מהסריקה השנייה והלאה הוא נפתח מיד, גם בלי אינטרנט.
 *
 * נשמר כהגדרה ולא בטבלה נפרדת, ולכן הוא גם עובר בין המכשירים
 * יחד עם שאר ההגדרות בסנכרון הענן.
 */
const MY_PRODUCTS_KEY = 'myBarcodeProducts';

async function getMyProducts() {
  try { return (await db.getSetting(MY_PRODUCTS_KEY, null)) || {}; }
  catch { return {}; }
}

async function saveMyProduct(code, product) {
  const all = await getMyProducts();
  all[code] = product;
  await db.setSetting(MY_PRODUCTS_KEY, all);
}

/** טופס ללמד את האפליקציה מוצר חדש, לפי מה שכתוב על האריזה */
function openTeachSheet(code) {
  const f = (placeholder) => el('input', {
    type: 'number', inputmode: 'decimal', min: '0', placeholder, autocomplete: 'off',
  });
  const name = el('input', { type: 'text', placeholder: 'למשל: קוטג׳ 5%', autocomplete: 'off' });
  const kcal = f('0'), prot = f('0'), carb = f('0'), fat = f('0');
  const pack = f('לא חובה');
  const unit = el('select', {}, el('option', { value: 'גרם' }, 'גרם'), el('option', { value: 'מ"ל' }, 'מ"ל'));

  const save = guard(async () => {
    if (!name.value.trim()) { toast('צריך שם למוצר', 'err'); return; }
    const product = {
      code,
      name: name.value.trim(),
      brand: '',
      image: null,
      liquid: unit.value === 'מ"ל',
      unit: unit.value,
      packageAmount: num(pack.value, 0) || null,
      packageLabel: pack.value ? `${pack.value} ${unit.value}` : '',
      servingAmount: null,
      per100: {
        calories: num(kcal.value, 0),
        protein: num(prot.value, 0),
        carbs: num(carb.value, 0),
        fat: num(fat.value, 0),
      },
    };
    await saveMyProduct(code, product);
    toast('נשמר — בפעם הבאה הוא ייפתח מיד', 'ok');
    openProductSheet(product);
  });

  const cell = (label, input, suffix) => el('div', { class: 'field' },
    el('label', {}, label), input, ...(suffix ? [el('small', { class: 'muted' }, suffix)] : []));

  openSheet('מוצר חדש', el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      `הברקוד ${code} לא קיים במאגר העולמי. הזן את מה שכתוב בטבלת הערכים על האריזה — ` +
      'זה חד־פעמי, ומהפעם הבאה הוא ייסרק מיד.'),
    cell('שם המוצר', name),
    el('div', { class: 'field' }, el('label', {}, 'יחידה'), unit),
    el('p', { class: 'muted', style: 'font-size:.85rem;margin:4px 0 10px' },
      `הערכים הבאים הם ל-100 ${unit.value} — בדיוק כמו שרשום על האריזה:`),
    cell('קלוריות ל-100', kcal),
    cell('חלבון ל-100', prot),
    cell('פחמימות ל-100', carb),
    cell('שומן ל-100', fat),
    cell('גודל האריזה', pack, 'לא חובה — אם תמלא, נדע לחשב אריזה שלמה'),
    el('button', { class: 'btn btn-primary btn-block', onclick: save }, 'שמור מוצר'),
  ));
  setTimeout(() => name.focus(), 120);
}

/** משותף לסריקה ולהזנה ידנית */
async function lookupAndShow(code) {
  // קודם המוצרים שלמדנו: מיידי, עובד אופליין, ומנצח את המאגר העולמי
  const mine = await getMyProducts();
  if (mine[code]) { openProductSheet(mine[code]); return; }

  toast('מחפש מוצר…');
  let product = null;
  let networkFailed = false;
  try {
    product = await fetchProduct(code);
  } catch (err) {
    console.warn('[Ori Fitness] שליפת מוצר נכשלה:', err);
    networkFailed = true;
  }

  if (product) { openProductSheet(product); return; }

  // לא נמצא (או שאין רשת) — מציעים ללמד אותו במקום להיתקע
  openTeachSheet(code);
  if (networkFailed) toast('אין חיבור למאגר — אפשר להזין ידנית', 'err');
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
    /*
     * הרזולוציה היא ההבדל בין סורק שעובד לסורק שלא.
     * בלי בקשה מפורשת הדפדפן פותח את המצלמה בברירת מחדל נמוכה
     * (לרוב 640x480), ובגודל כזה פשוט אין מספיק פיקסלים בקווי הברקוד
     * כדי לפענח אותו — הסורק מסתכל ולא רואה כלום.
     */
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
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

  /*
   * מיקוד רציף ותאורה — נשלחים בנפרד ובתוך try, ולא כחלק מהבקשה
   * הראשונה: אלה יכולות שלא כל מכשיר תומך בהן, ובקשה שכוללת אותן
   * מראש נכשלת כולה בדפדפן שלא מכיר אותן. עדיף מצלמה שנפתחה בלי
   * מיקוד רציף מאשר מצלמה שלא נפתחה בכלל.
   */
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() || {};
  try {
    if (caps.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch { /* לא נתמך — ממשיכים */ }

  // פנס: קריטי בסופר ובמטבח, אבל קיים רק בחלק מהמכשירים
  if (caps.torch) {
    let on = false;
    const torchBtn = el('button', { class: 'btn btn-secondary' }, '🔦 פנס');
    torchBtn.addEventListener('click', async () => {
      on = !on;
      try {
        await track.applyConstraints({ advanced: [{ torch: on }] });
        torchBtn.textContent = on ? '🔦 כבה' : '🔦 פנס';
      } catch { torchBtn.remove(); }
    });
    overlay.querySelector('.bc-actions')?.prepend(torchBtn);
  }

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
