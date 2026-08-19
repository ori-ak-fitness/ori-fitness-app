/* ===================================================================
   snacks.js — נשנושים: מה שאוכלים בלי לשקול ובלי ברקוד.

   הבעיה שזה פותר: בייגלה שטוח, חופן במבה, ריבוע שוקולד. אלה לא
   ארוחות ואין להם אריזה לסרוק, ולכן הם פשוט לא נרשמו — ואז היומן
   מראה פחות ממה שנאכל באמת.

   הפתרון: רשימה קצרה של דברים שמנשנשים, כל אחד עם משקל טיפוסי
   ליחידה, ומונה + / −. "בייגלה שטוח ×5" נשמר כארוחה רגילה.

   הכל מובנה בקובץ — בלי רשת, בלי מפתח API, עובד גם אופליין.

   ⚠️ הערכים מקורבים בכוונה. מוצר ספציפי יכול לסטות, ולכן המסך
   אומר את זה במפורש ואפשר לערוך כל רשומה אחרי ההוספה.
   =================================================================== */

import * as db from './db.js';
import { el, guard, num, fmtNum, toast, openSheet, closeSheet } from './ui.js';

let onAdded = null;   // רענון מסך התזונה אחרי הוספה
let getDate = null;   // התאריך שמוצג כרגע במסך התזונה

/* ---------- הטבלה ---------- */

/*
 * `grams` — משקל טיפוסי של יחידה אחת. `per100` — ערכים ל-100 גרם,
 * וזו הצורה שבה נתוני תזונה מפורסמים; החישוב ליחידה נגזר מהם ולא
 * נשמר בנפרד, כך שאין שתי גרסאות של אותו מספר שיכולות להיפרד.
 */
const SNACKS = [
  { name: 'בייגלה שטוח',    unit: 'יחידה', grams: 8,   per100: { calories: 400, protein: 11, carbs: 74, fat: 5 } },
  { name: 'במבה',           unit: 'חופן',  grams: 12,  per100: { calories: 550, protein: 14, carbs: 50, fat: 33 } },
  { name: 'ביסלי',          unit: 'חופן',  grams: 15,  per100: { calories: 470, protein: 9,  carbs: 62, fat: 20 } },
  { name: 'אפרופו',         unit: 'חופן',  grams: 12,  per100: { calories: 480, protein: 8,  carbs: 63, fat: 22 } },
  { name: 'צ׳יפס תפוחי אדמה', unit: 'חופן', grams: 15, per100: { calories: 540, protein: 6,  carbs: 53, fat: 34 } },
  { name: 'פופקורן',        unit: 'כוס',   grams: 10,  per100: { calories: 480, protein: 9,  carbs: 57, fat: 24 } },
  { name: 'קרקר',           unit: 'יחידה', grams: 5,   per100: { calories: 420, protein: 10, carbs: 72, fat: 10 } },
  { name: 'פרוסת לחם',      unit: 'פרוסה', grams: 30,  per100: { calories: 260, protein: 9,  carbs: 49, fat: 3 } },
  { name: 'עוגייה',         unit: 'יחידה', grams: 12,  per100: { calories: 470, protein: 6,  carbs: 65, fat: 21 } },
  { name: 'ריבוע שוקולד',   unit: 'ריבוע', grams: 8,   per100: { calories: 540, protein: 7,  carbs: 57, fat: 31 } },
  { name: 'חטיף אנרגיה',    unit: 'יחידה', grams: 25,  per100: { calories: 400, protein: 8,  carbs: 65, fat: 12 } },
  { name: 'שקדים',          unit: 'יחידה', grams: 1.2, per100: { calories: 580, protein: 21, carbs: 22, fat: 50 } },
  { name: 'אגוזי מלך',      unit: 'חצי אגוז', grams: 3, per100: { calories: 650, protein: 15, carbs: 14, fat: 65 } },
  { name: 'בוטנים',         unit: 'חופן',  grams: 15,  per100: { calories: 570, protein: 26, carbs: 16, fat: 49 } },
  { name: 'קשיו',           unit: 'יחידה', grams: 1.5, per100: { calories: 550, protein: 18, carbs: 30, fat: 44 } },
  { name: 'גרעינים',        unit: 'חופן',  grams: 15,  per100: { calories: 580, protein: 21, carbs: 20, fat: 49 } },
  { name: 'תמר',            unit: 'יחידה', grams: 8,   per100: { calories: 280, protein: 2,  carbs: 75, fat: 0 } },
  { name: 'בננה',           unit: 'יחידה', grams: 120, per100: { calories: 90,  protein: 1,  carbs: 23, fat: 0 } },
  { name: 'תפוח',           unit: 'יחידה', grams: 150, per100: { calories: 52,  protein: 0,  carbs: 14, fat: 0 } },
  { name: 'גזר',            unit: 'יחידה', grams: 60,  per100: { calories: 41,  protein: 1,  carbs: 10, fat: 0 } },
  { name: 'מלפפון',         unit: 'יחידה', grams: 110, per100: { calories: 15,  protein: 1,  carbs: 4,  fat: 0 } },
];

/** המאקרו של כמות יחידות, מעוגל למה שיש טעם להציג */
function macrosFor(snack, count) {
  const factor = (snack.grams * count) / 100;
  return {
    calories: Math.round(snack.per100.calories * factor),
    protein: Math.round(snack.per100.protein * factor * 10) / 10,
    carbs: Math.round(snack.per100.carbs * factor * 10) / 10,
    fat: Math.round(snack.per100.fat * factor * 10) / 10,
  };
}

function unitLine(snack) {
  const one = macrosFor(snack, 1);
  return `${snack.unit} ≈ ${fmtNum(snack.grams, snack.grams < 10 ? 1 : 0)} ג׳ · ${one.calories} קק״ל`;
}

/* ---------- הגיליון ---------- */

export function openSnacksSheet() {
  /* מה נבחר עד עכשיו. נשמר לפי שם ולא לפי מיקום ברשימה, כדי
     שסינון בחיפוש לא יאבד את מה שכבר נספר */
  const counts = new Map();

  const totalLine = el('div', { class: 'snack-total' });
  const addBtn = el('button', { class: 'btn btn-primary btn-block', disabled: true });

  function refreshTotal() {
    let calories = 0;
    let items = 0;
    for (const [name, n] of counts) {
      if (!n) continue;
      calories += macrosFor(SNACKS.find((s) => s.name === name), n).calories;
      items++;
    }
    totalLine.textContent = items
      ? `${items} פריטים · ${fmtNum(calories)} קק״ל`
      : 'עוד לא בחרת כלום';
    totalLine.classList.toggle('is-empty', !items);
    addBtn.textContent = items ? `הוסף ליומן (${fmtNum(calories)} קק״ל)` : 'הוסף ליומן';
    addBtn.disabled = !items;
  }

  function row(snack) {
    const countEl = el('b', { class: 'snack-count' }, '0');

    const bump = (delta) => {
      const next = Math.max(0, (counts.get(snack.name) || 0) + delta);
      counts.set(snack.name, next);
      countEl.textContent = String(next);
      item.classList.toggle('is-on', next > 0);
      refreshTotal();
    };

    const item = el('div', { class: 'snack-row' },
      el('div', { class: 'snack-main' },
        el('div', { class: 'snack-name' }, snack.name),
        el('div', { class: 'snack-sub' }, unitLine(snack)),
      ),
      el('div', { class: 'snack-stepper' },
        el('button', { class: 'snack-btn', type: 'button', 'aria-label': 'פחות', onclick: () => bump(-1) }, '−'),
        countEl,
        el('button', { class: 'snack-btn', type: 'button', 'aria-label': 'עוד', onclick: () => bump(1) }, '+'),
      ),
    );
    if (counts.get(snack.name)) { countEl.textContent = String(counts.get(snack.name)); item.classList.add('is-on'); }
    return item;
  }

  const list = el('div', { class: 'snack-list' });
  const draw = (term = '') => {
    const q = term.trim();
    const shown = q ? SNACKS.filter((s) => s.name.includes(q)) : SNACKS;
    list.replaceChildren(...(shown.length
      ? shown.map(row)
      : [el('p', { class: 'muted', style: 'padding:14px 4px' }, 'לא נמצא. אפשר להוסיף ידנית בכפתור "חדש".')]));
  };

  const search = el('input', {
    type: 'text', placeholder: 'חפש נשנוש…', autocomplete: 'off',
    oninput: (e) => draw(e.target.value),
  });

  addBtn.addEventListener('click', guard(async () => {
    const date = getDate?.() || null;
    let added = 0;
    for (const [name, n] of counts) {
      if (!n) continue;
      const snack = SNACKS.find((s) => s.name === name);
      const m = macrosFor(snack, n);
      await db.put(db.STORES.meals, {
        id: db.uid(),
        date,
        createdAt: Date.now(),
        // הכמות בשם ולא רק במספרים: ביומן רואים מיד "×5" בלי לפתוח
        name: n > 1 ? `${snack.name} ×${n}` : snack.name,
        ...m,
        // details נשאר ריק: הוא מסומן ביומן כ"יש תפריט כתוב", וכמות
        // בגרמים אינה זה. הכמות כבר קריאה מהשם.
        details: '',
        photo: null, thumb: null,
      });
      added++;
    }
    closeSheet();
    await onAdded?.();
    toast(added === 1 ? 'נוסף ליומן' : `${added} פריטים נוספו`, 'ok');
  }));

  /* הזנת קלוריות בלבד יושבת כאן ולא בכפתור נפרד: זו אותה כוונה —
     "אכלתי משהו קטן ולא בא לי להזין הכל" — ומסך התזונה כבר עמוס */
  const quickInput = el('input', { type: 'number', inputmode: 'numeric', min: '0', placeholder: 'קלוריות' });
  const quickAdd = guard(async () => {
    const calories = num(quickInput.value, 0);
    if (calories <= 0) { toast('הזן קלוריות תקינות', 'err'); return; }
    await db.put(db.STORES.meals, {
      id: db.uid(), date: getDate?.() || null, createdAt: Date.now(),
      name: 'תוספת מהירה', calories, protein: 0, carbs: 0, fat: 0,
      details: '', photo: null, thumb: null,
    });
    closeSheet();
    await onAdded?.();
    toast('נוסף', 'ok');
  });
  quickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });

  const body = el('div', {},
    el('div', { class: 'field' }, search),
    list,
    totalLine,
    addBtn,
    el('details', { class: 'snack-quick' },
      el('summary', {}, 'רק מספר קלוריות'),
      el('div', { class: 'snack-quick-row' },
        quickInput,
        el('button', { class: 'btn btn-secondary', onclick: quickAdd }, 'הוסף'),
      ),
    ),
    el('p', { class: 'muted snack-note' },
      'הערכים מקורבים ומשתנים בין מוצרים. אפשר לתקן כל רשומה אחרי ההוספה.'),
  );

  draw();
  refreshTotal();
  openSheet('🍿 נשנושים', body);
}

export function initSnacks({ onAdded: cb, currentDate } = {}) {
  onAdded = cb;
  getDate = currentDate;
}
