/* ===================================================================
   mealplan.js — מאגר המזון האישי + בניית היום.

   המודל: מגדירים פעם אחת מאגר של ארוחות וארוחות ביניים (שם + ערכים),
   ואז כל יום מרכיבים ממנו את היום בלחיצות — כמה פריטים שרוצים, בכל שעה,
   בלי מבנה קבוע של שלוש ארוחות. פריטים שמסומנים "קבוע" מוצעים מראש.

   הנתונים יושבים ב-STORES.mealPlan; רשומות ישנות (בלי kind) נחשבות
   לארוחות קבועות, כדי שתפריט שכבר בנית ימשיך לעבוד.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, closeSheet, confirmSheet,
  num, fmtNum, dateKey, guard, keepScroll,
} from './ui.js';

let libraryCache = null;
let onPlanChanged = null;

/* ---------- מודל ---------- */

export function invalidatePlanCache() { libraryCache = null; }

function normalize(item) {
  return {
    ...item,
    kind: item.kind ?? 'meal',          // 'meal' | 'snack'
    isDefault: item.isDefault ?? true,  // רשומות ישנות היו תפריט קבוע
    details: item.details ?? '',        // תיאור חופשי: מה בדיוק יש בארוחה
  };
}

/** כל המאגר: ארוחות + ארוחות ביניים */
export async function getPlan() {
  if (!libraryCache) {
    const all = await db.getAll(db.STORES.mealPlan);
    libraryCache = all
      .map(normalize)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return libraryCache;
}

function newFood(name = '', kind = 'meal') {
  return {
    id: db.uid(), name, kind,
    isDefault: kind === 'meal',
    calories: 0, protein: 0, carbs: 0, fat: 0,
    details: '',
    order: Date.now(),
  };
}

async function saveFood(item) {
  await db.put(db.STORES.mealPlan, item);
  invalidatePlanCache();
}

async function saveLibrary(items) {
  await db.clearStore(db.STORES.mealPlan);
  for (let i = 0; i < items.length; i++) {
    await db.put(db.STORES.mealPlan, { ...items[i], order: i });
  }
  invalidatePlanCache();
}

export async function planTotals() {
  const plan = await getPlan();
  return plan.filter((m) => m.isDefault).reduce((t, m) => ({
    calories: t.calories + num(m.calories, 0),
    protein:  t.protein  + num(m.protein, 0),
    carbs:    t.carbs    + num(m.carbs, 0),
    fat:      t.fat      + num(m.fat, 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/* ---------- רישום ליום ---------- */

const busy = new Set();

/** מוסיף פריט מהמאגר ליום. אפשר להוסיף את אותו פריט כמה פעמים. */
export async function addFoodToDay(item, date) {
  await db.put(db.STORES.meals, {
    id: db.uid(),
    date,
    createdAt: Date.now(),
    planId: item.id,
    name: item.name,
    kind: item.kind ?? 'meal',
    calories: num(item.calories, 0),
    protein: num(item.protein, 0),
    carbs: num(item.carbs, 0),
    fat: num(item.fat, 0),
    // תמונת מצב של תוכן הארוחה בזמן ההוספה — אם תערוך את הפריט במאגר
    // אחר כך, מה שכבר נרשם ליום לא ישתנה מתחתיו
    details: item.details ?? '',
    photo: null,
    thumb: null,
  });
  onPlanChanged?.();
}

/** סימון/ביטול של פריט קבוע. חסום להקשה כפולה. */
async function toggleDefault(item, date, row) {
  if (busy.has(item.id)) return;
  busy.add(item.id);

  const wasEaten = row.classList.contains('is-eaten');
  row.classList.toggle('is-eaten', !wasEaten);

  try {
    const dayMeals = await db.getAllByIndex(db.STORES.meals, 'date', IDBKeyRange.only(date));
    const existing = dayMeals.filter((m) => m.planId === item.id);
    if (existing.length) {
      for (const m of existing) await db.del(db.STORES.meals, m.id);
    } else {
      await addFoodToDay(item, date);
      return;   // addFoodToDay כבר מודיע על שינוי
    }
    onPlanChanged?.();
  } catch {
    row.classList.toggle('is-eaten', wasEaten);
    toast('לא הצלחתי לעדכן', 'err');
  } finally {
    busy.delete(item.id);
  }
}

/* ---------- תצוגה: מה שקבוע ליום ---------- */

export async function renderMealPlan(date, loggedMeals) {
  const host = $('#mealPlanList');
  const library = await getPlan();
  const defaults = library.filter((m) => m.isDefault);

  const eatenCount = defaults.filter((item) => loggedMeals.some((m) => m.planId === item.id)).length;
  const badge = $('#mealProgress');
  if (badge) {
    badge.textContent = defaults.length ? `${eatenCount} מתוך ${defaults.length}` : '';
    badge.classList.toggle('is-complete', defaults.length > 0 && eatenCount === defaults.length);
  }

  if (!defaults.length) {
    host.replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📝'),
      el('p', { html: library.length
        ? 'אין לך ארוחות קבועות.<br>הוסף מהמאגר מה שאכלת היום.'
        : 'עדיין אין מאגר מזון.<br>בנה אותו פעם אחת בהגדרות ⚙️, ואז תרכיב ממנו כל יום.' })));
    return;
  }

  host.replaceChildren(...defaults.map((item) => {
    const eaten = loggedMeals.some((m) => m.planId === item.id);
    const row = el('div', {
      class: `plan-meal${eaten ? ' is-eaten' : ''}`,
      onclick: () => toggleDefault(item, date, row),
      role: 'button',
      'aria-pressed': eaten ? 'true' : 'false',
    },
      el('div', { class: 'plan-check' }, eaten ? '✓' : ''),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, item.name),
        el('div', { class: 'li-sub' },
          `חלבון ${fmtNum(num(item.protein))}ג' · פחמימות ${fmtNum(num(item.carbs))}ג' · שומן ${fmtNum(num(item.fat))}ג'`),
        item.details ? el('button', {
          class: 'plan-note-btn',
          // כפתור מקונן בתוך שורה שהלחיצה עליה מסמנת "אכלתי" — עוצרים
          // את התפוצצות הקליק כדי שצפייה בתפריט לא תשנה בטעות את הסימון
          onclick: (e) => { e.stopPropagation(); showMealPlanDetails(item); },
        }, '📄 תפריט מלא') : null,
      ),
      el('div', { class: 'li-side' }, fmtNum(num(item.calories)), el('small', {}, 'קק"ל')),
    );
    return row;
  }));

  if (date < dateKey()) {
    host.append(el('p', { class: 'muted', style: 'margin-top:8px;text-align:center' },
      'סימון בתאריך עבר יירשם לאותו יום'));
  }
}

/** תצוגה של התפריט המלא שנכתב לפריט — למי ששוכח מה בדיוק בארוחה */
function showMealPlanDetails(item) {
  const body = el('div', {},
    el('div', { class: 'summary-grid', style: 'margin-bottom:16px' },
      el('div', { class: 'sg' }, el('b', {}, fmtNum(num(item.calories))), el('span', {}, 'קק"ל')),
      el('div', { class: 'sg' }, el('b', {},
        `${fmtNum(num(item.protein))}/${fmtNum(num(item.carbs))}/${fmtNum(num(item.fat))}`),
        el('span', {}, 'חלבון/פחמימות/שומן')),
    ),
    el('p', { class: 'meal-details-text' }, item.details),
    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:18px',
      onclick: () => { closeSheet(); openFoodEditor(item, null, () => onPlanChanged?.()); },
    }, 'ערוך פריט'),
  );
  openSheet(item.name, body);
}

/* ---------- בוחר מהמאגר ---------- */

/**
 * גיליון להוספה מהירה: חיפוש, ארוחות וארוחות ביניים, לחיצה אחת מוסיפה.
 * @param {string} date  היום שאליו מוסיפים
 * @param {() => void} onAdded
 */
export async function openFoodPicker(date, onAdded) {
  const library = await getPlan();

  const listHost = el('div', { class: 'list' });
  const search = el('input', {
    type: 'search', placeholder: 'חפש במאגר...', autocomplete: 'off',
    oninput: () => render(),
  });

  let filter = 'all';   // all | meal | snack

  const render = () => keepScroll(listHost, () => {
    const q = search.value.trim();
    const items = library.filter((m) =>
      (filter === 'all' || (m.kind ?? 'meal') === filter) &&
      (!q || m.name.includes(q)));

    if (!items.length) {
      listHost.replaceChildren(el('div', { class: 'empty-state', style: 'padding:22px' },
        el('p', {}, library.length ? 'אין התאמה לחיפוש' : 'המאגר ריק — אפשר להוסיף פריט חדש למטה')));
      return;
    }

    listHost.replaceChildren(...items.map((item) => el('div', {
      class: 'list-item',
      onclick: guard(async () => {
        await addFoodToDay(item, date);
        toast(`${item.name} נוסף`, 'ok');
        onAdded?.();
      }),
    },
      el('div', { class: 'cardio-icon' }, (item.kind ?? 'meal') === 'snack' ? '🍎' : '🍽️'),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, item.name),
        el('div', { class: 'li-sub' },
          `חלבון ${fmtNum(num(item.protein))}ג' · פחמימות ${fmtNum(num(item.carbs))}ג' · שומן ${fmtNum(num(item.fat))}ג'`),
      ),
      el('div', { class: 'li-side' }, fmtNum(num(item.calories)), el('small', {}, 'קק"ל')),
    )));
  });

  const tab = (label, value) => el('button', {
    class: `chip${filter === value ? ' is-on' : ''}`,
    onclick: (e) => {
      filter = value;
      for (const c of e.target.parentElement.children) c.classList.remove('is-on');
      e.target.classList.add('is-on');
      render();
    },
  }, label);

  const body = el('div', {},
    el('div', { class: 'field' }, search),
    el('div', { class: 'chip-row' }, tab('הכל', 'all'), tab('ארוחות', 'meal'), tab('ביניים', 'snack')),
    listHost,
    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:14px',
      onclick: () => { closeSheet(); openFoodEditor(null, date, onAdded); },
    }, '+ פריט חדש למאגר'),
  );

  render();
  openSheet('הוסף מהמאגר', body);
}

/* ---------- עורך פריט בודד ---------- */

export function openFoodEditor(existing, date, onAdded) {
  const item = existing ? { ...existing } : newFood('', 'snack');

  const f = (label, key, extra = {}) => el('div', { class: 'field' },
    el('label', {}, label),
    el('input', {
      type: 'number', inputmode: 'numeric', min: '0', value: item[key] || '',
      placeholder: '0', ...extra,
      oninput: (e) => { item[key] = num(e.target.value, 0); },
    }),
  );

  const nameInput = el('input', {
    type: 'text', value: item.name, placeholder: 'למשל: יוגורט עם גרנולה',
    oninput: (e) => { item.name = e.target.value; },
  });

  // תיאור חופשי של הארוחה — כדי שאפשר יהיה לראות באפליקציה בדיוק מה
  // אמור להיות בצלחת, בלי להסתמך על הזיכרון
  const detailsInput = el('textarea', {
    rows: 4, placeholder: 'לדוגמה: 2 ביצים מקושקשות, 2 פרוסות לחם מלא, קוטג׳ 5%, ירקות חתוכים',
    oninput: (e) => { item.details = e.target.value; },
  }, item.details || '');

  let kind = item.kind ?? 'snack';
  let isDefault = item.isDefault ?? false;

  const kindRow = el('div', { class: 'chip-row' },
    ...[['ארוחה', 'meal'], ['ארוחת ביניים', 'snack']].map(([label, value]) =>
      el('button', {
        class: `chip${kind === value ? ' is-on' : ''}`,
        onclick: (e) => {
          kind = value;
          for (const c of e.target.parentElement.children) c.classList.remove('is-on');
          e.target.classList.add('is-on');
        },
      }, label)),
  );

  const defaultToggle = el('label', { class: 'setting-row', style: 'margin-top:6px' },
    el('span', {},
      el('b', {}, 'קבוע ליום'),
      el('small', {}, 'יופיע כל יום ברשימת הסימון, בלי לחפש אותו'),
    ),
    el('input', {
      type: 'checkbox', checked: isDefault,
      onchange: (e) => { isDefault = e.target.checked; },
    }),
  );

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'שם'), nameInput),
    kindRow,
    f('קלוריות', 'calories'),
    el('div', { class: 'field-row-3' },
      f('חלבון (ג\')', 'protein'),
      f('פחמימות (ג\')', 'carbs'),
      f('שומן (ג\')', 'fat'),
    ),
    el('div', { class: 'field' }, el('label', {}, 'תוכן הארוחה (רשות)'), detailsInput),
    defaultToggle,

    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:16px',
      onclick: guard(async () => {
        if (!item.name.trim()) { toast('תן שם לפריט', 'err'); nameInput.focus(); return; }
        const saved = { ...item, name: item.name.trim(), kind, isDefault, details: (item.details || '').trim() };
        await saveFood(saved);
        closeSheet();
        if (date) { await addFoodToDay(saved, date); toast(`${saved.name} נוסף למאגר וליום`, 'ok'); }
        else toast('נשמר במאגר', 'ok');
        onAdded?.();
      }),
    }, date ? 'שמור והוסף להיום' : 'שמור'),

    existing ? el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
      onclick: guard(async () => {
        const ok = await confirmSheet('מחיקה מהמאגר', `למחוק את "${existing.name}"? ארוחות שכבר רשמת יישארו.`, 'מחק');
        if (!ok) return;
        await db.del(db.STORES.mealPlan, existing.id);
        invalidatePlanCache();
        closeSheet();
        onPlanChanged?.();
        onAdded?.();
        toast('נמחק');
      }),
    }, 'מחק מהמאגר') : null,
  );

  openSheet(existing ? 'עריכת פריט' : 'פריט חדש', body);
}

/* ---------- ניהול המאגר (מההגדרות) ---------- */

export async function openPlanEditor() {
  const library = await getPlan();

  const section = (title, items, emptyText) => el('div', {},
    el('div', { class: 'section-head', style: 'margin-top:18px' }, el('h2', {}, title)),
    items.length
      ? el('div', { class: 'list' }, ...items.map((item) => el('div', {
          class: 'list-item',
          onclick: () => { closeSheet(); openFoodEditor(item, null, () => openPlanEditor()); },
        },
          el('div', { class: 'cardio-icon' }, (item.kind ?? 'meal') === 'snack' ? '🍎' : '🍽️'),
          el('div', { class: 'li-main' },
            el('div', { class: 'li-title' }, item.name),
            el('div', { class: 'li-sub' },
              (item.isDefault ? 'קבוע ליום · ' : '') +
              `חלבון ${fmtNum(num(item.protein))}ג' · פחמימות ${fmtNum(num(item.carbs))}ג' · שומן ${fmtNum(num(item.fat))}ג'` +
              (item.details ? ' · 📄 יש תפריט כתוב' : '')),
          ),
          el('div', { class: 'li-side' }, fmtNum(num(item.calories)), el('small', {}, 'קק"ל')),
        )))
      : el('p', { class: 'muted', style: 'padding:4px 2px' }, emptyText),
  );

  const meals = library.filter((m) => (m.kind ?? 'meal') === 'meal');
  const snacks = library.filter((m) => m.kind === 'snack');
  const defaultKcal = library.filter((m) => m.isDefault).reduce((s, m) => s + num(m.calories, 0), 0);

  const body = el('div', {},
    el('p', { class: 'muted' },
      'המאגר שלך. פריטים שמסומנים "קבוע ליום" מופיעים כל יום לסימון; ' +
      'כל השאר זמינים בלחיצה מתוך "הוסף מהמאגר" — ארוחות ביניים, נשנושים, מה שבא לך.'),

    library.length ? el('div', { class: 'plan-total', style: 'margin-top:14px' },
      el('span', {}, 'סה"כ בקבועים'),
      el('b', {}, `${fmtNum(defaultKcal)} קק"ל`),
    ) : null,

    section('ארוחות', meals, 'עוד לא הוספת ארוחות'),
    section('ארוחות ביניים', snacks, 'עוד לא הוספת ארוחות ביניים'),

    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:18px',
      onclick: () => { closeSheet(); openFoodEditor(null, null, () => openPlanEditor()); },
    }, '+ פריט חדש'),

    library.length ? el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
      onclick: guard(async () => {
        const ok = await confirmSheet('מחיקת המאגר', 'למחוק את כל המאגר? ארוחות שכבר רשמת יישארו.', 'מחק הכל');
        if (!ok) return;
        await saveLibrary([]);
        closeSheet();
        onPlanChanged?.();
        toast('המאגר נמחק');
      }),
    }, 'מחק את כל המאגר') : null,
  );

  openSheet('מאגר המזון שלי', body);
}

/* ---------- אתחול ---------- */

export function initMealPlan({ onUpdate } = {}) {
  onPlanChanged = onUpdate;
}
