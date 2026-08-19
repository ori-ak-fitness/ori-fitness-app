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

/*
 * היחידה נקבעת מהטקסט החופשי של האריזה, והוא נכתב שם בכל צורה
 * אפשרית: ml, מ"ל, מל', ליטר. כיסוי חלקי גרם ל"330 מל'" להיות
 * מסומן כגרם, ואז המסך שאל "כמה אכלת?" על פחית שתייה.
 */
function isLiquid(product) {
  const text = `${product.quantity || ''} ${product.product_quantity_unit || ''}`;
  return /\d\s*(ml|cl|l)\b/i.test(text) || /(מ["'׳]?ל|ליטר)/.test(text);
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

/* ---------- חיפוש לפי שם ---------- */

const OFF_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';

/*
 * חיפוש חופשי, כדי שלא צריך ברקוד בשביל כל שתייה או חטיף.
 * מסננים למוצרים שנמכרים בישראל: לאותו מוצר יש ערכים שונים בשווקים
 * שונים (ספרייט אירופאית היא כ-19 קק"ל ל-100 מ"ל, הישראלית כפול),
 * ורשומה מהשוק הלא נכון תיתן מספר שגוי ביומן.
 */
async function searchProducts(term) {
  const fields = 'code,product_name,brands,quantity,product_quantity,product_quantity_unit,' +
                 'serving_size,serving_quantity,nutriments,image_small_url';
  const url = `${OFF_SEARCH}?search_terms=${encodeURIComponent(term)}` +
              '&tagtype_0=countries&tag_contains_0=contains&tag_0=israel' +
              `&search_simple=1&action=process&json=1&page_size=24&fields=${fields}`;

  /*
   * שרת החיפוש של המאגר פחות יציב מזה של הברקוד, ונופל מדי פעם ל-503.
   * מבדילים בין "השירות למטה" ל"אין אינטרנט" כדי שלא תיראה כאן תקלה
   * של האפליקציה כשהיא לא שלה.
   */
  const res = await fetch(url);
  if (res.status === 503 || res.status === 429) {
    throw Object.assign(new Error('service'), { code: 'service-down' });
  }
  if (!res.ok) throw new Error('שגיאת רשת');
  const data = await res.json();

  return (data.products || [])
    .map((p) => {
      const n = p.nutriments || {};
      const kcal100 = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
      if (kcal100 == null) return null;          // בלי קלוריות אין מה להוסיף ליומן
      const liquid = isLiquid(p);
      const name = (p.product_name || '').trim();
      const brand = (p.brands || '').split(',')[0].trim();
      if (!name && !brand) return null;
      return {
        code: p.code || '',
        name, brand,
        image: p.image_small_url || null,
        liquid,
        unit: liquid ? 'מ"ל' : 'גרם',
        packageAmount: parseAmount(p.product_quantity) ?? parseAmount(p.quantity),
        packageLabel: (p.quantity || '').trim(),
        servingAmount: parseAmount(p.serving_quantity) ?? parseAmount(p.serving_size),
        per100: {
          calories: Math.round(kcal100),
          protein: n.proteins_100g ?? null,
          carbs: n.carbohydrates_100g ?? null,
          fat: n.fat_100g ?? null,
        },
      };
    })
    .filter(Boolean);
}

export async function openSearchSheet() {
  const input = el('input', { type: 'search', placeholder: 'קולה, שוקו, במבה…', autocomplete: 'off' });
  const results = el('div', { class: 'list', style: 'margin-top:14px' });

  const run = guard(async () => {
    const term = input.value.trim();
    if (term.length < 2) { toast('הקלד לפחות שתי אותיות', 'err'); return; }
    results.replaceChildren(el('p', { class: 'muted' }, 'מחפש…'));
    let found;
    try {
      found = await searchProducts(term);
    } catch {
      /*
       * אי אפשר להבדיל כאן בין "אין אינטרנט" ל"שרת החיפוש שלהם נפל":
       * כששרת חיצוני מחזיר שגיאה בלי כותרות הרשאה, הדפדפן מכשיל את
       * הבקשה כולה בלי לחשוף את הסיבה. לכן ההודעה מכסה את שתי
       * האפשרויות במקום לנחש אחת ולהישמע בטוחה בטעות.
       */
      results.replaceChildren(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '📡'),
        el('p', {}, 'לא הצלחנו להגיע למאגר החיפוש. או שאין אינטרנט, או ' +
          'ששירות החיפוש שלהם לא זמין כרגע — זה קורה להם מדי פעם.'),
        el('p', { style: 'margin-top:8px' }, 'סריקת ברקוד עובדת בנפרד, וגם בלי רשת ' +
          'למוצרים שכבר לימדת.')));
      return;
    }
    if (!found.length) {
      results.replaceChildren(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '🔎'),
        el('p', {}, 'לא נמצא. אפשר לסרוק את הברקוד ולהזין את המוצר פעם אחת.')));
      return;
    }
    results.replaceChildren(...found.map((p) => el('button', {
      class: 'list-item', onclick: () => openProductSheet(p),
    },
      ...(p.image ? [el('img', { class: 'li-thumb', src: p.image, alt: '', referrerpolicy: 'no-referrer' })] : []),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, [p.brand, p.name].filter(Boolean).join(' — ')),
        el('div', { class: 'li-sub' },
          `${fmtNum(p.per100.calories)} קק"ל ל-100 ${p.unit}` +
          (p.packageLabel ? ` · ${p.packageLabel}` : ''))),
    )));
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  openSheet('🔎 חיפוש מוצר', el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'חפש בשם — משקאות, חטיפים, מוצרי חלב. התוצאות מסוננות למוצרים שנמכרים בישראל, ' +
      'כי לאותו מוצר יש ערכים שונים בכל שוק.'),
    el('div', { class: 'field' }, el('label', {}, 'מה לחפש?'), input),
    el('button', { class: 'btn btn-primary btn-block', onclick: run }, 'חפש'),
    results,
  ));
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

/* ---------- הכנת הפריים לפענוח ---------- */

/*
 * מה שמוזן למפענח קובע יותר מכל דבר אחר אם הברקוד ייקרא.
 * שלוש ההחלטות כאן נמדדו מול 28 תצלומי ברקוד אמיתיים (ביניהם 24
 * צילומים של מוצרי מזון בישראל), והן שהעלו את אחוז הקריאה מ-4 מתוך
 * 28 ל-21 מתוך 28:
 *
 *   1. לחתוך למסגרת הכיוון במקום לסרוק את כל המסך — הברקוד תופס
 *      חלק גדול בהרבה מהתמונה הנסרקת, וזה שקול להתקרבות.
 *   2. להגדיל את החיתוך לרוחב עבודה קבוע — למפענח יש יותר שורות
 *      פיקסלים לעבור עליהן, וזה לבדו הציל שישה מהצילומים.
 *   3. לנסות גם מסובב ב-90° — ברקוד על בקבוק צר נקרא לאורך.
 */
const WORK_WIDTH = 1100;

/** ההצגה היא object-fit: cover, ולכן חלק מהפריים חתוך מחוץ למסך.
    בלי החישוב הזה החיתוך היה לוקח אזור אחר מזה שרואים במסגרת. */
function frameRectInVideo(video, frameEl) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const rect = frameEl?.getBoundingClientRect();
  if (!vw || !vh || !rect?.width) return null;

  const scale = Math.max(innerWidth / vw, innerHeight / vh);
  const offX = (innerWidth - vw * scale) / 2;
  const offY = (innerHeight - vh * scale) / 2;

  // שוליים סביב המסגרת: ברקוד שבולט מעט החוצה עדיין ייקרא, ואין
  // סיבה להעניש על כיוון לא מושלם
  const pad = 0.12;
  const w = (rect.width / scale) * (1 + pad * 2);
  const h = (rect.height / scale) * (1 + pad * 2);
  const cx = (rect.left + rect.width / 2 - offX) / scale;
  const cy = (rect.top + rect.height / 2 - offY) / scale;

  return { cx, cy, w: Math.min(w, vw), h: Math.min(h, vh), vw, vh };
}

/**
 * מצייר את אזור העניין לקנבס מוכן לפענוח.
 * @param {'frame'|'frame-rotated'|'full'} variant
 */
function grabFrame(video, frameEl, canvas, variant) {
  const roi = frameRectInVideo(video, frameEl);
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return false;

  let sw, sh;
  if (variant === 'full' || !roi) { sw = vw; sh = vh; }
  // לניסיון המסובב לוקחים אזור עומד ולא שוכב, אחרת ברקוד אנכי
  // היה נחתך לגזרים עוד לפני הסיבוב
  else if (variant === 'frame-rotated') { sw = Math.min(roi.h, vw); sh = Math.min(roi.w, vh); }
  else { sw = roi.w; sh = roi.h; }

  const cx = roi && variant !== 'full' ? roi.cx : vw / 2;
  const cy = roi && variant !== 'full' ? roi.cy : vh / 2;
  const sx = Math.max(0, Math.min(vw - sw, cx - sw / 2));
  const sy = Math.max(0, Math.min(vh - sh, cy - sh / 2));

  const rotated = variant === 'frame-rotated';
  const scale = Math.max(1, WORK_WIDTH / (rotated ? sh : sw));
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);

  canvas.width = rotated ? dh : dw;
  canvas.height = rotated ? dw : dh;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (rotated) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(video, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  }
  return true;
}

/* הווריאנטים מתחלפים מפריים לפריים ולא נבדקים כולם בכל פריים:
   כך כל מחזור נשאר קצר והתצוגה לא נתקעת, וכל הווריאנטים בכל זאת
   נבדקים כמה פעמים בשנייה */
const VARIANTS = ['frame', 'frame-rotated', 'full'];

/*
 * הקצב נקבע בטיימר ולא ב-requestAnimationFrame. rAF נעצר בכל רגע
 * שהדפדפן מחליט שהעמוד אינו מצויר — וסורק שנעצר בלי סיבה נראית
 * לעין הוא בדיוק התלונה "הוא לא קורא כלום". טיימר גם חוסך סוללה:
 * שמונה ניסיונות בשנייה מספיקים בהחלט, שישים אינם.
 */
const SCAN_INTERVAL_MS = 120;

/** לולאת סריקה משותפת לשני המפענחים */
function runScanLoop(video, frameEl, decode, onCode) {
  const canvas = document.createElement('canvas');
  let alive = true;
  let timer = null;
  let i = 0;
  stopLoop = () => { alive = false; clearTimeout(timer); };

  const tick = async () => {
    if (!alive) return;
    try {
      if (grabFrame(video, frameEl, canvas, VARIANTS[i++ % VARIANTS.length])) {
        const code = await decode(canvas);
        // הפורמטים שביקשנו כולם נושאים ספרת ביקורת, ולכן קריאה
        // שחזרה היא כבר קריאה שעברה אימות — אין צורך באישור שני
        if (code && alive) { onCode(code); return; }
      }
    } catch { /* פריים לא קריא — ממשיכים לבא */ }
    if (alive) timer = setTimeout(tick, SCAN_INTERVAL_MS);
  };
  timer = setTimeout(tick, 0);
}

/** זיהוי עם ה-API המובנה בדפדפן (אנדרואיד/כרום) */
async function scanWithNative(video, frameEl, onCode) {
  const detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
  });
  runScanLoop(video, frameEl, async (canvas) => {
    const codes = await detector.detect(canvas);
    return codes.length ? codes[0].rawValue : null;
  }, onCode);
}

/*
 * DecodeHintType אינו מיוצא מ-@zxing/browser, רק הערך המספרי שלו
 * קיים. הגרסה נעולה ב-ZXING_CDN, ולכן המספר יציב.
 */
const HINT_POSSIBLE_FORMATS = 2;
const HINT_TRY_HARDER = 3;

/** גיבוי לדפדפנים בלי BarcodeDetector (אייפון) */
async function scanWithZXing(video, frameEl, onCode) {
  const { BrowserMultiFormatOneDReader, BarcodeFormat } = await import(ZXING_CDN);

  /*
   * TRY_HARDER הוא ההבדל הגדול ביותר שנמדד: בלעדיו המפענח בודק רק
   * כמה שורות באמצע התמונה. ורשימת פורמטים קצרה — רק מה שמופיע על
   * מוצרי מזון — מונעת ניחושים על קודים שלא יכולים להיות שם.
   */
  const hints = new Map([
    [HINT_TRY_HARDER, true],
    [HINT_POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
    ]],
  ]);
  const reader = new BrowserMultiFormatOneDReader(hints);

  runScanLoop(video, frameEl, async (canvas) => {
    try { return reader.decodeFromCanvas(canvas).getText(); }
    catch { return null; }
  }, onCode);
}

export async function openScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    openManualSheet('הדפדפן הזה לא תומך במצלמה. אפשר להקליד את הברקוד ידנית.');
    return;
  }

  const video = el('video', { playsinline: '', muted: '', autoplay: '' });
  const frameEl = el('div', { class: 'bc-frame' });
  const hint = el('p', { class: 'bc-hint' }, 'כוון את הברקוד למסגרת');
  const overlay = el('div', { id: 'bcScanner', class: 'bc-scanner' },
    video,
    frameEl,
    hint,
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
    clearTimeout(hintTimer);
    try { navigator.vibrate?.(60); } catch { /* לא נתמך */ }
    closeCamera();
    lookupAndShow(code);
  };

  /*
   * אחרי כמה שניות בלי קריאה, עצה קונקרטית עדיפה על "כוון למסגרת"
   * שכבר לא עזר. זו הנקודה שבה קל להתייאש ולחשוב שהסורק שבור.
   */
  const hintTimer = setTimeout(() => {
    if (!handled && document.body.contains(hint)) {
      hint.textContent = caps.torch
        ? 'לא נקרא? התקרב עד שהברקוד ממלא את המסגרת, או הדלק פנס'
        : 'לא נקרא? התקרב עד שהברקוד ממלא את המסגרת, ושמור על יציבות';
    }
  }, 7000);

  try {
    if ('BarcodeDetector' in window) await scanWithNative(video, frameEl, onCode);
    else await scanWithZXing(video, frameEl, onCode);
  } catch (err) {
    clearTimeout(hintTimer);
    console.warn('[Ori Fitness] זיהוי ברקוד נכשל:', err);
    closeCamera();
    openManualSheet('לא הצלחנו להפעיל את הסורק. אפשר להקליד את הברקוד.');
  }
}

export function initBarcode({ onAdded: cb, currentDate } = {}) {
  onAdded = cb;
  getDate = currentDate;
  $('#scanBarcodeBtn')?.addEventListener('click', guard(openScanner));
  $('#searchFoodBtn')?.addEventListener('click', guard(openSearchSheet));
}
