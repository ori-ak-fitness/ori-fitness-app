/* ===================================================================
   onboarding.js — אשף הגדרה ראשונית. רץ בכניסה הראשונה לאפליקציה
   ומכין את הדברים הקבועים: תוכניות אימון, שיבוץ לימים, אירובי ותפריט.
   אפשר לדלג על כל שלב ולהשלים אחר כך דרך ההגדרות.
   =================================================================== */

import * as db from './db.js';
import { $, el, toast, num, fmtNum, keepScroll } from './ui.js';
import { getRoutines, getSchedule, DAY_NAMES, DAY_SHORT } from './routines.js';
import { getCardioTemplates } from './cardio.js';
import { getPlan } from './mealplan.js';
import { calcRecommendedCalories, ACTIVITY_LEVELS, GOAL_KINDS } from './nutrition.js';
import {
  calcBMI, bmiCategory, setUserHeightCm, setUserAge, setUserSex, setActivityLevel,
  getUserHeightCm, getUserAge, getUserSex, getActivityLevel, getWeightEntries,
} from './bodyweight.js';

const DONE_KEY = 'onboardingDone';

let step = 0;
let onFinish = null;

/* ---------- מצב זמני של האשף ---------- */
const draft = {
  name: '',                          // שם פרטי — לברכה ולסיום אימון
  routines: [],                      // { id, name, exercises:[{name, sets, reps}] }
  schedule: [null, null, null, null, null, null, null],
  cardio: [],                        // { name, minutes, icon }
  meals: [],                         // { name, calories, protein, carbs, fat }
  goal: { calories: 2200, protein: 150, carbs: 220, fat: 70 },
  bodyStats: null,                   // { weight, height, age, sex, activity, goal } — לחישוב BMI/קלוריות
};

const CARDIO_OPTIONS = [
  { name: 'ריצה', minutes: 30, icon: '🏃' },
  { name: 'הליכון', minutes: 40, icon: '🚶' },
  { name: 'אופניים', minutes: 45, icon: '🚴' },
  { name: 'חבל קפיצה', minutes: 15, icon: '🪢' },
  { name: 'שחייה', minutes: 30, icon: '🏊' },
];

/* ---------- שלבים ---------- */

const steps = [stepWelcome, stepRoutines, stepSchedule, stepCardio, stepMenu, stepBodyStats, stepGoal, stepDone];

function stepWelcome() {
  const nameInput = el('input', {
    type: 'text', value: draft.name, placeholder: 'איך קוראים לך?', autocomplete: 'off',
    style: 'margin-top:4px',
    oninput: (e) => { draft.name = e.target.value; },
  });

  return {
    canSkip: false,
    nextLabel: 'בוא נתחיל',
    node: el('div', {},
      el('div', { class: 'wizard-emoji' }, '🏋️'),
      el('h2', {}, 'ברוך הבא ל-Ori Fitness'),
      el('p', { class: 'muted' },
        'נגדיר יחד את הדברים הקבועים — אילו אימונים אתה עושה, באילו ימים, ומה התפריט שלך. ' +
        'זה לוקח דקה, ואחר כך כל אימון הוא כמה לחיצות.'),
      el('p', { class: 'muted' }, 'אפשר לדלג על כל שלב ולהשלים אותו מאוחר יותר בהגדרות.'),
      el('div', { class: 'field', style: 'margin-top:16px' },
        el('label', {}, 'השם שלך'),
        nameInput,
      ),
      el('p', { class: 'muted', style: 'font-size:.78rem' },
        'נשתמש בו כדי לברך אותך בבית ולחגוג איתך בסוף אימון. אפשר להשאיר ריק.'),
    ),
  };
}

function stepRoutines() {
  const listHost = el('div', { class: 'plan-ex-list' });

  const renderList = () => keepScroll(listHost, () => {
    if (!draft.routines.length) {
      listHost.replaceChildren(el('div', { class: 'empty-state', style: 'padding:18px' },
        el('p', {}, 'הוסף אימון ראשון — למשל "אימון A — חזה וכתפיים"')));
      return;
    }
    listHost.replaceChildren(...draft.routines.map((r, i) => el('div', { class: 'plan-ex' },
      el('div', { class: 'plan-ex-idx' }, String(i + 1)),
      el('div', { class: 'plan-ex-main' },
        el('input', {
          type: 'text', value: r.name, placeholder: 'שם האימון',
          oninput: (e) => { r.name = e.target.value; },
        }),
        el('input', {
          type: 'text', value: r.exercises.map((x) => x.name).join(', '),
          placeholder: 'תרגילים, מופרדים בפסיק',
          oninput: (e) => {
            r.exercises = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              .map((name) => ({ name, sets: 3, reps: '8-12' }));
          },
        }),
      ),
      el('div', { class: 'plan-ex-actions' },
        el('button', {
          class: 'icon-btn', 'aria-label': 'מחק',
          onclick: () => { draft.routines.splice(i, 1); renderList(); },
        }, '✕'),
      ),
    )));
  });
  renderList();

  return {
    canSkip: true,
    node: el('div', {},
      el('h2', {}, 'אילו אימונים אתה עושה?'),
      el('p', { class: 'muted' },
        'תן שם לכל אימון ורשום את התרגילים שלו, מופרדים בפסיק. כל תרגיל מקבל 3 סטים כברירת מחדל — אפשר לשנות אחר כך.'),
      listHost,
      el('button', {
        class: 'add-set-btn', style: 'margin-top:10px',
        onclick: () => {
          draft.routines.push({ id: db.uid(), name: '', exercises: [] });
          renderList();
          listHost.querySelector('.plan-ex:last-child input')?.focus();
        },
      }, '+ אימון'),
    ),
  };
}

function stepSchedule() {
  const named = draft.routines.filter((r) => r.name.trim());
  const host = el('div', { class: 'list' });

  const render = () => {
    host.replaceChildren(...DAY_NAMES.map((day, i) => {
      const current = draft.schedule[i];
      const chosen = named.find((r) => r.id === current);
      return el('div', { class: 'list-item is-static' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `יום ${day}`),
          el('div', { class: 'li-sub' }, chosen ? chosen.name : 'מנוחה'),
        ),
        el('select', {
          class: 'day-select',
          onchange: (e) => { draft.schedule[i] = e.target.value || null; render(); },
        },
          el('option', { value: '', selected: !current }, 'מנוחה'),
          ...named.map((r) => el('option', { value: r.id, selected: current === r.id }, r.name)),
        ),
      );
    }));
  };
  render();

  if (!named.length) {
    return {
      canSkip: true,
      node: el('div', {},
        el('h2', {}, 'שיבוץ לימי השבוע'),
        el('p', { class: 'muted' }, 'עוד לא הגדרת אימונים, אז אין מה לשבץ. אפשר לחזור אחורה ולהוסיף, או לדלג ולעשות את זה אחר כך בהגדרות.'),
      ),
    };
  }

  return {
    canSkip: true,
    node: el('div', {},
      el('h2', {}, 'מתי אתה עושה מה?'),
      el('p', { class: 'muted' }, 'זו רק ברירת המחדל — תמיד תוכל להתחיל אימון אחר ביום נתון.'),
      host,
    ),
  };
}

function stepCardio() {
  const host = el('div', { class: 'chip-row' });

  const render = () => {
    host.replaceChildren(...CARDIO_OPTIONS.map((o) => {
      const on = draft.cardio.some((c) => c.name === o.name);
      return el('button', {
        class: `chip${on ? ' is-on' : ''}`,
        onclick: () => {
          if (on) draft.cardio = draft.cardio.filter((c) => c.name !== o.name);
          else draft.cardio.push({ ...o });
          render();
        },
      }, `${o.icon} ${o.name}${on ? ' ✓' : ''}`);
    }));
  };
  render();

  return {
    canSkip: true,
    node: el('div', {},
      el('h2', {}, 'עושה גם אירובי?'),
      el('p', { class: 'muted' }, 'בחר את הסוגים שאתה עושה. אחר כך תסמן אותם בלחיצה אחת, כמה פעמים שבא לך ביום.'),
      host,
    ),
  };
}

/** שורה ריקה חדשה לתפריט — kind קובע אם היא מוצגת כארוחה או כארוחת ביניים */
function newMenuRow(name = '', kind = 'meal') {
  return { name, kind, calories: 0, protein: 0, carbs: 0, fat: 0 };
}

/**
 * שדה מספרי עם כותרת מפורשת מעליו ויחידה מתחתיו.
 * בלי הכותרת אי אפשר לדעת אם מקלידים חלבון, פחמימה או שומן.
 */
function macroCell(label, unit, value, onChange) {
  return el('label', { class: 'macro-cell' },
    el('span', { class: 'macro-cell-label' }, label),
    el('input', {
      type: 'number', inputmode: 'numeric', min: '0',
      value: value || '', placeholder: '0',
      oninput: (e) => onChange(num(e.target.value, 0)),
    }),
    el('span', { class: 'macro-cell-unit' }, unit),
  );
}

function stepMenu() {
  if (!draft.meals.length) {
    // חמישה מקומות פנויים: שלוש ארוחות עיקריות + שתי ארוחות ביניים ביניהן.
    // כולן מתחילות ריקות (0 בכל השדות) — מי שלא ממלא, לא נשמר בסוף.
    draft.meals = [
      newMenuRow('ארוחת בוקר', 'meal'),
      newMenuRow('ארוחת ביניים', 'snack'),
      newMenuRow('ארוחת צהריים', 'meal'),
      newMenuRow('ארוחת ביניים', 'snack'),
      newMenuRow('ארוחת ערב', 'meal'),
    ];
  }
  const listHost = el('div', { class: 'plan-ex-list' });
  const total = el('div', { class: 'plan-total' });

  const updateTotal = () => {
    const kcal = draft.meals.reduce((s, m) => s + num(m.calories, 0), 0);
    total.replaceChildren(el('span', {}, 'סה"כ בתפריט'), el('b', {}, `${fmtNum(kcal)} קק"ל`));
  };

  const render = () => keepScroll(listHost, () => {
    listHost.replaceChildren(...draft.meals.map((m, i) => el('div', { class: 'plan-ex' },
      el('div', { class: 'plan-ex-idx' }, m.kind === 'snack' ? '🍎' : String(i + 1)),
      el('div', { class: 'plan-ex-main' },
        el('input', {
          type: 'text', value: m.name,
          placeholder: m.kind === 'snack' ? 'שם ארוחת הביניים (אופציונלי)' : 'שם הארוחה',
          oninput: (e) => { m.name = e.target.value; },
        }),
        // כותרת מפורשת מעל כל שדה, בסדר: קלוריות, חלבון, פחמימות, שומן
        el('div', { class: 'macro-grid' },
          macroCell('קלוריות', 'קק"ל', m.calories, (v) => { m.calories = v; updateTotal(); }),
          macroCell('חלבון', 'גרם', m.protein, (v) => { m.protein = v; }),
          macroCell('פחמימות', 'גרם', m.carbs, (v) => { m.carbs = v; }),
          macroCell('שומן', 'גרם', m.fat, (v) => { m.fat = v; }),
        ),
      ),
      el('div', { class: 'plan-ex-actions' },
        el('button', {
          class: 'icon-btn', 'aria-label': 'מחק',
          onclick: () => { draft.meals.splice(i, 1); render(); updateTotal(); },
        }, '✕'),
      ),
    )));
  });
  render(); updateTotal();

  return {
    canSkip: true,
    node: el('div', {},
      el('h2', {}, 'התפריט הקבוע שלך'),
      el('p', { class: 'muted' },
        'הארוחות שאתה אוכל ביום רגיל, כולל ארוחות ביניים בין בוקר לצהריים ובין צהריים לערב. ' +
        'אחר כך רק תסמן וי על מה שאכלת. שורה שתשאיר ריקה לגמרי — פשוט לא נשמרת.'),
      listHost,
      el('div', { class: 'chip-row', style: 'margin-top:10px' },
        el('button', {
          class: 'chip',
          onclick: () => { draft.meals.push(newMenuRow('', 'meal')); render(); listHost.querySelector('.plan-ex:last-child input')?.focus(); },
        }, '+ ארוחה'),
        el('button', {
          class: 'chip',
          onclick: () => { draft.meals.push(newMenuRow('', 'snack')); render(); listHost.querySelector('.plan-ex:last-child input')?.focus(); },
        }, '🍎 + ארוחת ביניים'),
      ),
      total,
    ),
  };
}

function stepBodyStats() {
  if (!draft.bodyStats) {
    draft.bodyStats = { weight: '', height: '', age: '', sex: 'male', activity: 'moderate', goal: 'maintain' };
  }
  const bs = draft.bodyStats;
  const resultBox = el('div', { class: 'summary-grid', style: 'margin:14px 0' });

  const recalc = () => {
    const weightKg = num(bs.weight, 0), h = num(bs.height, 0), a = num(bs.age, 0);
    const bmi = calcBMI(weightKg, h);
    let kcal = null;
    if (weightKg > 0 && h > 0 && a > 0) {
      kcal = calcRecommendedCalories({ weightKg, heightCm: h, age: a, sex: bs.sex, activityKey: bs.activity, goalKey: bs.goal });
      draft.goal.calories = kcal;
    }
    resultBox.replaceChildren(
      el('div', { class: 'sg' }, el('b', {}, bmi ? fmtNum(bmi, 1) : '—'), el('span', {}, bmi ? `BMI · ${bmiCategory(bmi)}` : 'BMI')),
      el('div', { class: 'sg' }, el('b', {}, kcal ? fmtNum(kcal) : '—'), el('span', {}, 'קק"ל מומלץ ליום')),
    );
  };

  const numField = (label, key, mode, placeholder) => el('div', { class: 'field' },
    el('label', {}, label),
    el('input', {
      type: 'number', inputmode: mode, min: '0', value: bs[key], placeholder,
      oninput: (e) => { bs[key] = e.target.value; recalc(); },
    }),
  );

  const sexSelect = el('select', { onchange: (e) => { bs.sex = e.target.value; recalc(); } },
    el('option', { value: 'male', selected: bs.sex !== 'female' }, 'זכר'),
    el('option', { value: 'female', selected: bs.sex === 'female' }, 'נקבה'),
  );
  const activitySelect = el('select', { onchange: (e) => { bs.activity = e.target.value; recalc(); } },
    ...ACTIVITY_LEVELS.map((a) => el('option', { value: a.key, selected: a.key === bs.activity }, a.label)));
  const goalSelect = el('select', { onchange: (e) => { bs.goal = e.target.value; recalc(); } },
    ...GOAL_KINDS.map((g) => el('option', { value: g.key, selected: g.key === bs.goal }, g.label)));

  recalc();

  return {
    canSkip: true,
    node: el('div', {},
      el('h2', {}, 'קצת עליך'),
      el('p', { class: 'muted' },
        'עוזר לחשב BMI והמלצת קלוריות יומית לשלב הבא. אפשר לדלג ולמלא ידנית, או מאוחר יותר בהגדרות.'),
      el('div', { class: 'field-row-3' },
        numField('משקל (ק"ג)', 'weight', 'decimal', '75'),
        numField('גובה (ס"מ)', 'height', 'numeric', '170'),
        numField('גיל', 'age', 'numeric', '30'),
      ),
      el('div', { class: 'field-row-3' },
        el('div', { class: 'field' }, el('label', {}, 'מין'), sexSelect),
        el('div', { class: 'field', style: 'grid-column:span 2' }, el('label', {}, 'רמת פעילות'), activitySelect),
      ),
      el('div', { class: 'field' }, el('label', {}, 'המטרה שלך'), goalSelect),
      resultBox,
    ),
  };
}

function stepGoal() {
  const f = (id, label, value, unit) => el('div', { class: 'field' },
    el('label', { for: id }, label),
    el('input', {
      id, type: 'number', inputmode: 'numeric', min: '0', value,
      oninput: (e) => { draft.goal[unit] = num(e.target.value, 0); },
    }),
  );

  return {
    canSkip: true,
    node: el('div', {},
      el('h2', {}, 'יעד יומי'),
      el('p', { class: 'muted' }, 'כמה קלוריות ומאקרו אתה מכוון אליהם ביום. תמיד אפשר לשנות, וגם להגדיר יעד חדש מתאריך מסוים כשעוברים לחיטוב או למסה.'),
      f('obGoalKcal', 'קלוריות ליום', draft.goal.calories, 'calories'),
      el('div', { class: 'field-row-3' },
        f('obGoalP', 'חלבון (ג\')', draft.goal.protein, 'protein'),
        f('obGoalC', 'פחמימות (ג\')', draft.goal.carbs, 'carbs'),
        f('obGoalF', 'שומן (ג\')', draft.goal.fat, 'fat'),
      ),
    ),
  };
}

function stepDone() {
  const routines = draft.routines.filter((r) => r.name.trim()).length;
  const days = draft.schedule.filter(Boolean).length;
  // אותו תנאי בדיוק כמו ב-persist(): שם מלא וגם לפחות ערך אחד שאינו אפס,
  // אחרת השורה לא באמת נשמרת ולא נכון לספור אותה כאן.
  const meals = draft.meals.filter((m) =>
    m.name.trim() && (num(m.calories, 0) || num(m.protein, 0) || num(m.carbs, 0) || num(m.fat, 0))).length;

  return {
    canSkip: false,
    nextLabel: 'סיימתי, בוא נתאמן',
    node: el('div', {},
      el('div', { class: 'wizard-emoji' }, '✅'),
      el('h2', {}, 'הכל מוכן'),
      el('div', { class: 'summary-grid', style: 'margin:16px 0' },
        el('div', { class: 'sg' }, el('b', {}, String(routines)), el('span', {}, routines === 1 ? 'אימון' : 'אימונים')),
        el('div', { class: 'sg' }, el('b', {}, String(days)), el('span', {}, days === 1 ? 'יום משובץ' : 'ימים משובצים')),
        el('div', { class: 'sg' }, el('b', {}, String(draft.cardio.length)), el('span', {}, 'סוגי אירובי')),
        el('div', { class: 'sg' }, el('b', {}, String(meals)), el('span', {}, meals === 1 ? 'ארוחה' : 'ארוחות')),
      ),
      el('p', { class: 'muted' },
        'כל אלה נשמרים כהגדרות קבועות. כדי לשנות אותם בהמשך — גלגל השיניים ⚙️ בפינה העליונה. ' +
        'במסכי היומיום אפשר רק לבצע, כדי שלא תזיז משהו בטעות באמצע אימון.'),
    ),
  };
}

/* ---------- שמירה ---------- */

async function persist() {
  await db.setSetting('userName', draft.name.trim());

  // האשף כותב את המצב המלא. מנקים קודם, אחרת הרצה חוזרת מכפילה הכל.
  // אימונים שכבר ביצעת נשמרים ב-workouts ולא נוגעים בהם.
  await db.clearStore(db.STORES.routines);
  await db.clearStore(db.STORES.mealPlan);

  let order = 0;
  const idMap = new Map();

  for (const r of draft.routines) {
    if (!r.name.trim()) continue;
    const id = db.uid();
    idMap.set(r.id, id);
    await db.put(db.STORES.routines, {
      id, kind: 'strength', name: r.name.trim(), note: '',
      exercises: r.exercises.map((x) => ({ id: db.uid(), name: x.name, sets: x.sets ?? 3, reps: x.reps ?? '8-12' })),
      order: order++, createdAt: Date.now(),
    });
  }

  const schedule = draft.schedule.map((tempId) => (tempId ? idMap.get(tempId) ?? null : null));
  await db.setSetting('weekSchedule', schedule);

  let cOrder = 0;
  for (const c of draft.cardio) {
    await db.put(db.STORES.routines, {
      id: db.uid(), kind: 'cardio', name: c.name, minutes: c.minutes, icon: c.icon, order: cOrder++,
    });
  }

  let mOrder = 0;
  for (const m of draft.meals) {
    if (!m.name.trim()) continue;
    // השלב מציע מקומות ריקים לארוחות ולארוחות ביניים. אם דילגת בלי
    // למלא כלום, אין טעם לשמור אותם — הם היו מופיעים בתפריט עם 0 קלוריות.
    const empty = !num(m.calories, 0) && !num(m.protein, 0) && !num(m.carbs, 0) && !num(m.fat, 0);
    if (empty) continue;
    await db.put(db.STORES.mealPlan, {
      id: db.uid(), name: m.name.trim(), kind: m.kind === 'snack' ? 'snack' : 'meal', isDefault: true,
      calories: num(m.calories, 0), protein: num(m.protein, 0),
      carbs: num(m.carbs, 0), fat: num(m.fat, 0), order: mOrder++,
    });
  }

  const bs = draft.bodyStats;
  if (bs) {
    const weightKg = num(bs.weight, 0), heightCm = num(bs.height, 0), age = num(bs.age, 0);
    if (heightCm > 0) await setUserHeightCm(heightCm);
    if (age > 0) await setUserAge(age);
    if (bs.sex) await setUserSex(bs.sex);
    if (bs.activity) await setActivityLevel(bs.activity);
    if (weightKg > 0) {
      const today = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const todayKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
      await db.put(db.STORES.bodyWeight, { date: todayKey, weight: weightKg, loggedAt: Date.now() });
    }
  }

  const g = draft.goal;
  if (g.calories > 0) {
    await db.put(db.STORES.goals, {
      id: db.uid(),
      effectiveFrom: new Date().toISOString().slice(0, 10),
      calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat,
    });
  }

  await db.setSetting(DONE_KEY, true);
}

/* ---------- תצוגה ---------- */

function render() {
  const config = steps[step]();

  $('#wizardSteps').replaceChildren(
    ...steps.map((_, i) => el('span', { class: i <= step ? 'done' : '' })));

  const body = $('#wizardBody');
  body.replaceChildren(config.node);
  body.scrollTop = 0;

  $('#wizardBack').classList.toggle('hidden', step === 0);
  $('#wizardSkip').classList.toggle('hidden', !config.canSkip);
  $('#wizardNext').textContent = config.nextLabel ?? 'המשך';
}

async function next() {
  if (step === steps.length - 1) {
    await persist();
    close();
    onFinish?.();
    toast('הכל מוכן. בהצלחה! 💪', 'ok', 3500);
    return;
  }
  step++;
  render();
}

function back() { if (step > 0) { step--; render(); } }
function skip() { if (step < steps.length - 1) { step++; render(); } }

function close() { $('#wizard').classList.add('hidden'); }

export function openWizard() {
  step = 0;
  render();
  $('#wizard').classList.remove('hidden');
}

/** האם להריץ את האשף — רק בכניסה ראשונה, וכשאין עדיין שום נתון */
export async function shouldRunWizard() {
  if (await db.getSetting(DONE_KEY, false)) return false;
  const [routines, cardio, plan] = await Promise.all([getRoutines(), getCardioTemplates(), getPlan()]);
  return routines.length === 0 && cardio.length === 0 && plan.length === 0;
}

export function initOnboarding({ onDone } = {}) {
  onFinish = onDone;
  $('#wizardNext').addEventListener('click', next);
  $('#wizardBack').addEventListener('click', back);
  $('#wizardSkip').addEventListener('click', skip);
}

/** הפעלה חוזרת מההגדרות — מתחילים מהמצב הקיים כדי לא לדרוס */
export async function rerunWizard() {
  const [name, routines, schedule, cardio, plan, heightCm, age, sex, activity, entries] = await Promise.all([
    db.getSetting('userName', ''), getRoutines(), getSchedule(), getCardioTemplates(), getPlan(),
    getUserHeightCm(), getUserAge(), getUserSex(), getActivityLevel(), getWeightEntries(),
  ]);
  draft.name = name || '';
  draft.routines = routines.map((r) => ({
    id: r.id, name: r.name,
    exercises: r.exercises.map((x) => ({ name: x.name, sets: x.sets, reps: x.reps })),
  }));
  draft.schedule = [...schedule];
  draft.cardio = cardio.map((c) => ({ name: c.name, minutes: c.minutes, icon: c.icon }));
  draft.meals = plan.map((m) => ({ ...m }));
  draft.bodyStats = {
    weight: entries.length ? String(entries[entries.length - 1].weight) : '',
    height: heightCm ?? '', age: age ?? '', sex: sex || 'male', activity: activity || 'moderate', goal: 'maintain',
  };
  openWizard();
}

export { DAY_SHORT };
