/* ===================================================================
   nutrition.js — יומן תזונה: יעדים לפי תאריך תחילה, ארוחות עם תמונה,
   מעקב קלוריות ומאקרו ליום נבחר.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, closeSheet, confirmSheet,
  dateKey, formatDateHe, formatTime, shiftDateKey,
  num, fmtNum, guard, resizeImage, blobUrl, pickFileOnce, macroLine,
} from './ui.js';
import { renderMealPlan, getPlan, openFoodPicker } from './mealplan.js';
import {
  getUserHeightCm, getUserAge, getUserSex, getActivityLevel,
  setUserHeightCm, setUserAge, setUserSex, setActivityLevel,
  getWeightEntries, calcBMI, bmiCategory,
} from './bodyweight.js';

const DEFAULT_GOAL = { calories: 2200, protein: 150, carbs: 220, fat: 70 };

let currentDate = dateKey();
let goalsCache = null;
let onChanged = null;

/* ---------- התפריט המלא שלי ---------- */

// הערה קבועה אחת (לא לפי יום) — התוכנית הכללית שלך, למי ששוכח מה לאכול
const FULL_MENU_KEY = 'fullMenuNote';

async function renderFullMenu() {
  const text = (await db.getSetting(FULL_MENU_KEY, '')).trim();
  const card = $('#fullMenuCard');
  card.classList.toggle('is-empty', !text);
  card.textContent = text || 'עוד לא כתבת את התפריט המלא שלך. לחץ "ערוך" ורשום מה אתה אמור לאכול, כדי שלא תשכח.';
}

function openFullMenuEditor() {
  const textInput = el('textarea', {
    rows: 10, placeholder: 'לדוגמה:\nבוקר: 2 ביצים, לחם מלא, קוטג׳\nצהריים: חזה עוף, אורז, סלט\nערב: יוגורט, פרי',
  });

  db.getSetting(FULL_MENU_KEY, '').then((v) => { textInput.value = v; });

  const body = el('div', {},
    el('div', { class: 'field' }, textInput),
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        await db.setSetting(FULL_MENU_KEY, textInput.value.trim());
        await renderFullMenu();
        closeSheet();
        toast('נשמר', 'ok');
      }),
    }, 'שמור'),
  );

  openSheet('התפריט המלא שלי', body);
  setTimeout(() => textInput.focus(), 120);
}

/* ---------- יעדים ---------- */

/** מאפס את המטמון — נדרש אחרי ייבוא גיבוי */
export function invalidateGoalsCache() {
  goalsCache = null;
}

async function loadGoals() {
  if (goalsCache) return goalsCache;
  const all = await db.getAll(db.STORES.goals);
  goalsCache = all.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return goalsCache;
}

/** היעד התקף לתאריך נתון = היעד האחרון שתאריך התחילה שלו <= התאריך */
export async function goalForDate(date) {
  const goals = await loadGoals();
  let match = null;
  for (const g of goals) {
    if (g.effectiveFrom <= date) match = g;
    else break;
  }
  return match
    ? { calories: g0(match.calories), protein: g0(match.protein), carbs: g0(match.carbs), fat: g0(match.fat), effectiveFrom: match.effectiveFrom }
    : { ...DEFAULT_GOAL, effectiveFrom: null };
}

const g0 = (v) => num(v, 0);

async function saveGoal(goal) {
  const goals = await loadGoals();
  // יעד קיים לאותו תאריך תחילה — מעדכנים במקום ליצור כפול
  const existing = goals.find((g) => g.effectiveFrom === goal.effectiveFrom);
  const row = { id: existing?.id ?? db.uid(), ...goal };
  await db.put(db.STORES.goals, row);
  goalsCache = null;
}

/* ---------- ארוחות ---------- */

async function mealsForDate(date) {
  const rows = await db.getAllByIndex(db.STORES.meals, 'date', IDBKeyRange.only(date));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function totalsForDate(date) {
  const meals = await mealsForDate(date);
  return meals.reduce((t, m) => ({
    calories: t.calories + num(m.calories, 0),
    protein:  t.protein  + num(m.protein, 0),
    carbs:    t.carbs    + num(m.carbs, 0),
    fat:      t.fat      + num(m.fat, 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/* ---------- תצוגה ---------- */


export async function renderNutrition() {
  $('#nutDateLabel').textContent = formatDateHe(currentDate);

  const [goal, totals, meals] = await Promise.all([
    goalForDate(currentDate),
    totalsForDate(currentDate),
    mealsForDate(currentDate),
  ]);

  const remaining = goal.calories - totals.calories;
  const over = remaining < 0;

  // תג עם סך הקלוריות שנאכלו היום, בראש "התפריט של היום" — כדי לראות
  // את המספר בלי לגלול למטה לטבעת
  $('#kcalTodayBadge').textContent = `${fmtNum(Math.round(totals.calories))} קק"ל היום`;

  $('#kcalCard').classList.toggle('over', over);

  // מרכז הטבעת — אותו מספר "נותרו/חריגה" שהיה בשורת הסיכום
  $('#kcalFootLabel').textContent = over ? 'חריגה של' : 'נותרו';
  $('#kcalFootNum').textContent = fmtNum(Math.abs(Math.round(remaining)));
  $('#kcalFootGoal').textContent = fmtNum(goal.calories);

  /*
   * קשתות הטבעת — לפי חלקו של כל מאקרו בקלוריות שנאכלו, לא בגרמים:
   * שומן שוקל 9 קק"ל לגרם מול 4 לחלבון/פחמימות, אז חלוקה לפי גרם
   * הייתה מציגה אותו גדול הרבה יותר משהוא תורם בפועל לעיגול.
   */
  const ringCirc = 2 * Math.PI * 50;
  const macroKcal = {
    protein: totals.protein * 4,
    carbs: totals.carbs * 4,
    fat: totals.fat * 9,
  };
  const macroKcalTotal = macroKcal.protein + macroKcal.carbs + macroKcal.fat;
  let cursor = 0;
  for (const key of ['protein', 'carbs', 'fat']) {
    const seg = $(`.kcal-ring-seg[data-macro="${key}"]`);
    const len = macroKcalTotal > 0 ? (macroKcal[key] / macroKcalTotal) * ringCirc : 0;
    seg.style.strokeDasharray = `${len} ${ringCirc - len}`;
    seg.style.strokeDashoffset = String(-cursor);
    cursor += len;
  }

  // מאקרו — כמה נשאר, לא רק כמה נאכל
  for (const [key, cur] of Object.entries({ protein: totals.protein, carbs: totals.carbs, fat: totals.fat })) {
    const row = $(`.macro[data-macro="${key}"]`);
    const target = goal[key] || 0;
    const left = Math.round(target - cur);

    row.querySelector('.m-cur').textContent = fmtNum(Math.round(cur));
    row.querySelector('.m-goal').textContent = fmtNum(target);

    /*
     * שורת "נותרו X ג׳" הוסרה — היא שילשה את גובה המקטע בשביל מספר
     * שכבר נגזר ממה שכתוב לידו. חריגה וסיום עדיין נראים, בצבע המספר.
     */
    row.classList.toggle('is-over', left < 0);
    row.classList.toggle('is-done', target > 0 && left <= 0);
  }

  // התפריט הקבוע — סימון "אכלתי"
  await renderMealPlan(currentDate, meals);

  // כאן מוצג כל מה שנרשם היום, חוץ מהפעם הראשונה שסימנו כל פריט קבוע —
  // זו כבר מוצגת למעלה עם ✓. אם אותו פריט קבוע נוסף שוב (מנה נוספת,
  // דרך "+ מהמאגר"), הוא כן מופיע כאן — אחרת הוא היה נספר בקלוריות
  // בלי שיהיה אפשר לראות אותו או למחוק אותו.
  const defaultIds = new Set((await getPlan()).filter((p) => p.isDefault).map((p) => p.id));
  const seenDefault = new Set();
  const extras = meals.filter((m) => {
    if (!m.planId || !defaultIds.has(m.planId)) return true;
    if (seenDefault.has(m.planId)) return true;   // מנה נוספת של אותו פריט קבוע
    seenDefault.add(m.planId);
    return false;                                  // המופע הראשון — כבר מוצג למעלה
  });

  const host = $('#mealList');
  if (!extras.length) {
    host.replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🍎'),
      el('p', { html: 'לא הוספת עוד כלום היום.<br>"+ מהמאגר" לתוספת מהירה, או "חדש" למשהו אחר.' })));
  } else {
    host.replaceChildren(...extras.map(renderMealRow));
  }

  onChanged?.();
}

function renderMealRow(meal) {
  const thumb = meal.thumb || meal.photo;
  return el('div', { class: 'list-item', onclick: () => openMealSheet(meal) },
    thumb
      ? el('img', { class: 'li-thumb', src: blobUrl(thumb), alt: '' })
      : el('div', { class: 'li-thumb', style: 'display:grid;place-items:center;font-size:1.2rem' }, '🍴'),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, meal.name || 'ארוחה'),
      el('div', { class: 'li-sub' },
        `${formatTime(meal.createdAt)} · ${macroLine(meal.protein, meal.carbs, meal.fat)}` +
        (meal.details ? ' · 📄 יש תפריט כתוב' : '')),
    ),
    el('div', { class: 'li-side' }, fmtNum(num(meal.calories)), el('small', {}, 'קק"ל')),
  );
}

/* ---------- גיליון ארוחה (הוספה / עריכה) ---------- */

function openMealSheet(existing = null) {
  const isEdit = !!existing;
  let photoBlob = existing?.photo ?? null;
  let thumbBlob = existing?.thumb ?? null;
  let photoChanged = false;

  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const preview = el('div', { class: 'photo-picker', onclick: () => pickFileOnce(fileInput) },
    photoBlob
      ? el('img', { src: blobUrl(photoBlob), alt: '' })
      : el('div', { class: 'ph-hint' }, '📷 הוסף תמונה לארוחה'),
  );

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      photoBlob = await resizeImage(file, 1280, 0.82);
      thumbBlob = await resizeImage(file, 320, 0.75);
      photoChanged = true;
      preview.replaceChildren(el('img', { src: blobUrl(photoBlob), alt: '' }));
    } catch (err) {
      toast('לא הצלחתי לטעון את התמונה', 'err');
    }
  });

  const f = (id, label, value, extra = {}) => el('div', { class: 'field' },
    el('label', { for: id }, label),
    el('input', { id, value: value ?? '', ...extra }),
  );

  const body = el('div', {},
    f('mealName', 'שם הארוחה', existing?.name ?? '', { type: 'text', placeholder: 'למשל: ארוחת בוקר' }),
    f('mealKcal', 'קלוריות', existing?.calories ?? '', { type: 'number', inputmode: 'numeric', placeholder: '0', min: '0' }),
    el('div', { class: 'field-row-3' },
      f('mealProtein', 'חלבון (ג\')', existing?.protein ?? '', { type: 'number', inputmode: 'decimal', placeholder: '0', min: '0' }),
      f('mealCarbs', 'פחמימות (ג\')', existing?.carbs ?? '', { type: 'number', inputmode: 'decimal', placeholder: '0', min: '0' }),
      f('mealFat', 'שומן (ג\')', existing?.fat ?? '', { type: 'number', inputmode: 'decimal', placeholder: '0', min: '0' }),
    ),
    el('div', { class: 'field' },
      el('label', { for: 'mealDetails' }, 'תוכן הארוחה (רשות)'),
      el('textarea', {
        id: 'mealDetails', rows: 4,
        placeholder: 'לדוגמה: 2 ביצים מקושקשות, 2 פרוסות לחם מלא, קוטג׳ 5%, ירקות חתוכים',
      }, existing?.details ?? ''),
    ),
    el('div', { class: 'field' }, el('label', {}, 'תמונה'), preview, fileInput),
    el('button', { class: 'btn btn-primary btn-block', onclick: guard(save) }, isEdit ? 'שמור שינויים' : 'הוסף ארוחה'),
    isEdit ? el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
      onclick: async () => {
        const ok = await confirmSheet('מחיקת ארוחה', 'למחוק את הארוחה?', 'מחק');
        if (!ok) return;
        await db.del(db.STORES.meals, existing.id);
        await renderNutrition();
        toast('הארוחה נמחקה');
      },
    }, 'מחק ארוחה') : null,
  );

  async function save() {
    const name = $('#mealName', body).value.trim();
    const calories = num($('#mealKcal', body).value, 0);
    if (!name && !calories) { toast('הזן לפחות שם או קלוריות', 'err'); return; }

    const meal = {
      id: existing?.id ?? db.uid(),
      date: existing?.date ?? currentDate,
      createdAt: existing?.createdAt ?? Date.now(),
      name: name || 'ארוחה',
      calories,
      protein: num($('#mealProtein', body).value, 0),
      carbs:   num($('#mealCarbs', body).value, 0),
      fat:     num($('#mealFat', body).value, 0),
      details: $('#mealDetails', body).value.trim(),
      photo: photoChanged ? photoBlob : (existing?.photo ?? null),
      thumb: photoChanged ? thumbBlob : (existing?.thumb ?? null),
    };
    await db.put(db.STORES.meals, meal);
    closeSheet();
    await renderNutrition();
    toast(isEdit ? 'הארוחה עודכנה' : 'הארוחה נוספה', 'ok');
  }

  openSheet(isEdit ? 'עריכת ארוחה' : 'ארוחה חדשה', body);
}

/* ---------- מחשבון קלוריות: BMI + יעד יומי מומלץ לפי גיל/מין/פעילות/מטרה ---------- */

export const ACTIVITY_LEVELS = [
  { key: 'sedentary', label: 'לא פעיל (עבודת משרד, בלי אימונים)', mult: 1.2 },
  { key: 'light', label: 'פעילות קלה (1-3 אימונים בשבוע)', mult: 1.375 },
  { key: 'moderate', label: 'פעילות בינונית (3-5 אימונים בשבוע)', mult: 1.55 },
  { key: 'active', label: 'פעיל (6-7 אימונים בשבוע)', mult: 1.725 },
  { key: 'very_active', label: 'פעיל מאוד (אימונים יומיים + עבודה פיזית)', mult: 1.9 },
];

export const GOAL_KINDS = [
  { key: 'cut', label: 'לרדת במשקל (חיטוב)', adjust: -400 },
  { key: 'maintain', label: 'לשמור על המשקל', adjust: 0 },
  { key: 'bulk', label: 'לעלות במסה', adjust: 350 },
];

/** BMR לפי נוסחת Mifflin-St Jeor */
function calcBMR({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

/** קלוריות יומיות מומלצות: BMR × פעילות, ±התאמה לפי מטרה. מעוגל לעשרות. */
export function calcRecommendedCalories({ weightKg, heightCm, age, sex, activityKey, goalKey }) {
  const bmr = calcBMR({ weightKg, heightCm, age, sex });
  const activity = ACTIVITY_LEVELS.find((a) => a.key === activityKey) ?? ACTIVITY_LEVELS[2];
  const goal = GOAL_KINDS.find((g) => g.key === goalKey) ?? GOAL_KINDS[1];
  const tdee = bmr * activity.mult;
  return Math.max(0, Math.round((tdee + goal.adjust) / 10) * 10);
}

export async function openCalorieCalculatorSheet() {
  const [heightCm, age, sex, activityKey, entries] = await Promise.all([
    getUserHeightCm(), getUserAge(), getUserSex(), getActivityLevel(), getWeightEntries(),
  ]);
  const lastWeight = entries.length ? entries[entries.length - 1].weight : null;

  const heightInput = el('input', { type: 'number', inputmode: 'numeric', min: '0', max: '260', value: heightCm ?? '', placeholder: '170' });
  const weightInput = el('input', { type: 'number', inputmode: 'decimal', min: '0', value: lastWeight ?? '', placeholder: '75' });
  const ageInput = el('input', { type: 'number', inputmode: 'numeric', min: '0', max: '120', value: age ?? '', placeholder: '30' });
  const sexSelect = el('select', {},
    el('option', { value: 'male', selected: sex !== 'female' }, 'זכר'),
    el('option', { value: 'female', selected: sex === 'female' }, 'נקבה'),
  );
  const activitySelect = el('select', {},
    ...ACTIVITY_LEVELS.map((a) => el('option', { value: a.key, selected: a.key === activityKey }, a.label)));
  const goalSelect = el('select', {},
    ...GOAL_KINDS.map((g) => el('option', { value: g.key, selected: g.key === 'maintain' }, g.label)));

  const resultBox = el('div', { class: 'summary-grid', style: 'margin:16px 0' });

  const recalc = () => {
    const weightKg = num(weightInput.value, 0);
    const h = num(heightInput.value, 0);
    const a = num(ageInput.value, 0);
    const bmi = calcBMI(weightKg, h);
    const kcal = (weightKg > 0 && h > 0 && a > 0)
      ? calcRecommendedCalories({ weightKg, heightCm: h, age: a, sex: sexSelect.value, activityKey: activitySelect.value, goalKey: goalSelect.value })
      : null;

    resultBox.replaceChildren(
      el('div', { class: 'sg' }, el('b', {}, bmi ? fmtNum(bmi, 1) : '—'), el('span', {}, bmi ? `BMI · ${bmiCategory(bmi)}` : 'BMI')),
      el('div', { class: 'sg' }, el('b', {}, kcal ? fmtNum(kcal) : '—'), el('span', {}, 'קק"ל מומלץ ליום')),
    );
    return { weightKg, h, a, kcal };
  };
  [heightInput, weightInput, ageInput].forEach((i) => i.addEventListener('input', recalc));
  [sexSelect, activitySelect, goalSelect].forEach((i) => i.addEventListener('change', recalc));
  recalc();

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'הזן את הפרטים שלך כדי לקבל הערכת BMI והמלצת קלוריות יומית — לא לרדת ולא לעלות, ואז מתאימים לפי המטרה שבחרת.'),
    el('div', { class: 'field-row-3' },
      el('div', { class: 'field' }, el('label', {}, 'משקל (ק"ג)'), weightInput),
      el('div', { class: 'field' }, el('label', {}, 'גובה (ס"מ)'), heightInput),
      el('div', { class: 'field' }, el('label', {}, 'גיל'), ageInput),
    ),
    el('div', { class: 'field-row-3' },
      el('div', { class: 'field' }, el('label', {}, 'מין'), sexSelect),
      el('div', { class: 'field', style: 'grid-column:span 2' }, el('label', {}, 'רמת פעילות'), activitySelect),
    ),
    el('div', { class: 'field' }, el('label', {}, 'המטרה שלך'), goalSelect),
    resultBox,
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        const { weightKg, h, a, kcal } = recalc();
        if (!kcal) { toast('מלא משקל, גובה וגיל', 'err'); return; }
        await Promise.all([
          setUserHeightCm(h), setUserAge(a), setUserSex(sexSelect.value), setActivityLevel(activitySelect.value),
        ]);
        const current = await goalForDate(currentDate);
        await saveGoal({
          effectiveFrom: currentDate,
          calories: kcal, protein: current.protein, carbs: current.carbs, fat: current.fat,
        });
        closeSheet();
        await renderNutrition();
        toast(`היעד עודכן ל-${fmtNum(kcal)} קק"ל`, 'ok');
      }),
    }, 'הגדר כיעד היומי'),
  );

  openSheet('מחשבון קלוריות', body);
}

/* ---------- גיליון יעד ---------- */

export async function openGoalSheet() {
  const current = await goalForDate(currentDate);
  const goals = await loadGoals();

  const f = (id, label, value, extra = {}) => el('div', { class: 'field' },
    el('label', { for: id }, label),
    el('input', { id, value: value ?? '', ...extra }),
  );

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'היעד תקף מהתאריך שתבחר והלאה, עד שתגדיר יעד חדש. כך אפשר לעבור בין מחזורי חיטוב למסה בלי לאבד היסטוריה.'),
    f('goalFrom', 'בתוקף מתאריך', current.effectiveFrom ?? currentDate, { type: 'date' }),
    f('goalKcal', 'קלוריות ליום', current.calories, { type: 'number', inputmode: 'numeric', min: '0' }),
    el('div', { class: 'field-row-3' },
      f('goalProtein', 'חלבון (ג\')', current.protein, { type: 'number', inputmode: 'numeric', min: '0' }),
      f('goalCarbs', 'פחמימות (ג\')', current.carbs, { type: 'number', inputmode: 'numeric', min: '0' }),
      f('goalFat', 'שומן (ג\')', current.fat, { type: 'number', inputmode: 'numeric', min: '0' }),
    ),
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        const effectiveFrom = $('#goalFrom', body).value || currentDate;
        await saveGoal({
          effectiveFrom,
          calories: num($('#goalKcal', body).value, 0),
          protein:  num($('#goalProtein', body).value, 0),
          carbs:    num($('#goalCarbs', body).value, 0),
          fat:      num($('#goalFat', body).value, 0),
        });
        closeSheet();
        await renderNutrition();
        toast('היעד נשמר', 'ok');
      }),
    }, 'שמור יעד'),

    goals.length ? el('div', {},
      el('div', { class: 'section-head' }, el('h2', {}, 'יעדים קיימים')),
      el('div', { class: 'list' }, ...goals.slice().reverse().map((g) => el('div', { class: 'list-item' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `מ-${formatDateHe(g.effectiveFrom, { withYear: true })}`),
          el('div', { class: 'li-sub' }, `ח ${g.protein} · פ ${g.carbs} · ש ${g.fat}`),
        ),
        el('div', { class: 'li-side' }, fmtNum(num(g.calories)), el('small', {}, 'קק"ל')),
        el('button', {
          class: 'icon-btn', 'aria-label': 'מחק יעד',
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await confirmSheet('מחיקת יעד', 'למחוק את היעד הזה?', 'מחק');
            if (!ok) return;
            await db.del(db.STORES.goals, g.id);
            goalsCache = null;
            closeSheet();
            await renderNutrition();
          },
        }, '🗑'),
      ))),
    ) : null,
  );

  openSheet('יעד תזונה', body);
}

/* ---------- ניווט תאריכים ---------- */

function goToDate(date) {
  currentDate = date;
  renderNutrition();
}

/* ---------- אתחול ---------- */

export async function initNutrition({ onUpdate } = {}) {
  onChanged = onUpdate;

  $('#nutPrevDay').addEventListener('click', () => goToDate(shiftDateKey(currentDate, -1)));
  $('#nutNextDay').addEventListener('click', () => {
    const next = shiftDateKey(currentDate, 1);
    if (next > dateKey()) { toast('אי אפשר לתכנן קדימה עדיין'); return; }
    goToDate(next);
  });

  const picker = $('#nutDatePicker');
  $('#nutDateLabel').addEventListener('click', () => {
    picker.value = currentDate;
    picker.max = dateKey();
    picker.showPicker ? picker.showPicker() : picker.click();
  });
  picker.addEventListener('change', () => { if (picker.value) goToDate(picker.value); });

  $('#addMealBtn').addEventListener('click', () => openMealSheet(null));
  $('#addFromLibraryBtn').addEventListener('click', guard(() =>
    openFoodPicker(currentDate, () => renderNutrition())));

  $('#editFullMenuBtn').addEventListener('click', guard(openFullMenuEditor));
  await renderFullMenu();

  await renderNutrition();
}

/** התאריך שהמסך מציג כרגע */
export function currentNutritionDate() {
  return currentDate;
}

export async function resetToToday() {
  const today = dateKey();
  if (currentDate === today) return;
  currentDate = today;
  await renderNutrition();
}
