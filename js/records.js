/* ===================================================================
   records.js — שיאים אישיים: מה המשקל הכי כבד שהרמת בכל תרגיל,
   אילו סטים שברו שיא, וההתראה 🏆 שקופצת ברגע שזה קורה.

   המודול הזה לא מייבא כלום מ-workouts.js בכוונה — כך גם יומן
   האימונים וגם גרפי ההתקדמות יכולים להישען עליו בלי תלות מעגלית.
   =================================================================== */

import { $, el, num, fmtNum, confetti } from './ui.js';

/* ---------- מודל ---------- */

/**
 * האם הסט בוצע. הדגל done הוא מקור האמת, כדי שביטול סימון באמת
 * יוציא את הסט מהספירה. אימונים ישנים נשמרו בלי הדגל — שם נופלים
 * לבדיקה לפי הנתונים עצמם (משקל 0 תקף — מתח, בטן).
 */
export function isSetDone(s) {
  return s.done ?? (String(s.weight ?? '').trim() !== '' && num(s.reps, 0) > 0);
}

/**
 * המשקל שנספר לשיא בסט הזה, או 0 אם הסט לא נספר בכלל.
 * תרגילי משקל גוף (0 ק"ג) לא נכנסים למרוץ השיאים — אין שם מה להשוות.
 */
export function liftedWeight(s) {
  if (!isSetDone(s)) return 0;
  const w = num(s.weight, 0);
  return (w > 0 && num(s.reps, 0) > 0) ? w : 0;
}

/**
 * מספר החזרות שנספר לשיא בסט הזה, או 0 אם הסט לא נספר בכלל.
 * אותו תנאי הכשירות כמו במשקל — צריך גם משקל וגם חזרות.
 */
export function liftedReps(s) {
  if (!isSetDone(s)) return 0;
  const w = num(s.weight, 0), r = num(s.reps, 0);
  return (w > 0 && r > 0) ? r : 0;
}

/** רק אימוני כוח — לאירובי אין משקלים */
function strengthOnly(workouts) {
  return workouts.filter((w) => (w.kind ?? 'strength') === 'strength');
}

/**
 * המשקל הכבד ביותר שהורם אי־פעם בכל תרגיל.
 * @returns {Map<string, number>} שם תרגיל -> משקל בק"ג
 */
export function bestWeightByExercise(workouts) {
  const best = new Map();
  for (const w of strengthOnly(workouts)) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const weight = liftedWeight(s);
        if (weight > (best.get(ex.name) ?? 0)) best.set(ex.name, weight);
      }
    }
  }
  return best;
}

/**
 * מספר החזרות הגבוה ביותר שבוצע אי־פעם בכל תרגיל (בכל משקל שהוא —
 * לא לפי אותו משקל בדיוק, ראה הערה ב-checkRepPR ב-workouts.js).
 * @returns {Map<string, number>} שם תרגיל -> מספר חזרות
 */
export function bestRepsByExercise(workouts) {
  const best = new Map();
  for (const w of strengthOnly(workouts)) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const reps = liftedReps(s);
        if (reps > (best.get(ex.name) ?? 0)) best.set(ex.name, reps);
      }
    }
  }
  return best;
}

/**
 * אילו סטים בהיסטוריה שברו שיא. מחושב מחדש בכל רינדור ולא נשמר,
 * כך שגם מחיקת אימון או ייבוא גיבוי מעדכנים את הסימונים מיד.
 *
 * הפעם הראשונה שעושים תרגיל אינה "שיא" — אין עדיין מה לשבור.
 * משם והלאה, כל סט שעובר את הכי כבד שהיה לפניו מסומן.
 *
 * @returns {Map<string, Set<string>>} מזהה אימון -> מזהי הסטים ששברו שיא
 */
export function prSetsByWorkout(workouts) {
  const bestWeight = new Map();
  const bestReps = new Map();
  const byWorkout = new Map();

  for (const w of strengthOnly(workouts).sort((a, b) => a.startedAt - b.startedAt)) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const weight = liftedWeight(s);
        const reps = liftedReps(s);
        if (!weight && !reps) continue;

        let broke = false;

        if (weight) {
          const prevW = bestWeight.get(ex.name);
          if (prevW === undefined) bestWeight.set(ex.name, weight);
          else if (weight > prevW) { bestWeight.set(ex.name, weight); broke = true; }
        }

        // שיא חזרות נספר גם הוא — עקביות עם checkPR ב-workouts.js,
        // כדי שתגית 🏆 לא תיעלם כשחוזרים להיסטוריה אחרי שהופיעה בזמן אמת
        if (reps) {
          const prevR = bestReps.get(ex.name);
          if (prevR === undefined) bestReps.set(ex.name, reps);
          else if (reps > prevR) { bestReps.set(ex.name, reps); broke = true; }
        }

        if (!broke) continue;
        if (!byWorkout.has(w.id)) byWorkout.set(w.id, new Set());
        byWorkout.get(w.id).add(s.id);
      }
    }
  }
  return byWorkout;
}

/* ---------- ההתראה 🏆 ---------- */

const POP_MS = 3800;

// כמה שיאים ברצף (סט אחרי סט) מוצגים בתור, ולא דורסים זה את זה
const queue = [];
let popTimer = null;
let showing = false;

/**
 * מקפיץ 🏆 על המסך. נקרא ברגע שהסט מסומן כבוצע, לא בסוף האימון.
 * @param {{name: string, kind?: 'weight'|'reps', value: number, prev: number}} record
 *        kind ברירת מחדל 'weight' לתאימות לאחור
 */
export function announcePR(record) {
  queue.push(record);
  if (!showing) showNext();
}

/** מסתיר את ההתראה ומרוקן את התור (בסיום אימון, או בלחיצה) */
export function dismissPR() {
  queue.length = 0;
  hide();
}

function showNext() {
  const record = queue.shift();
  if (!record) { hide(); return; }
  showing = true;

  const isReps = record.kind === 'reps';
  const unit = isReps ? 'חזרות' : 'ק"ג';
  const digits = isReps ? 0 : 1;

  $('#prKicker').textContent = isReps ? 'שיא חזרות חדש' : 'שיא אישי חדש';
  $('#prExercise').textContent = record.name;
  $('#prWeight').textContent = `${fmtNum(record.value, digits)} ${unit}`;
  $('#prPrev').textContent =
    `הקודם ${fmtNum(record.prev, digits)} · +${fmtNum(record.value - record.prev, digits)} ${unit}`;

  $('#prPop').classList.remove('hidden');

  // מפעילים את האנימציה מחדש גם כשהכרטיס כבר על המסך (שיא שני ברצף)
  const card = $('#prCard');
  card.classList.remove('pr-in');
  void card.offsetWidth;
  card.classList.add('pr-in');

  confetti($('#prConfetti'), 34);
  buzz();

  clearTimeout(popTimer);
  popTimer = setTimeout(showNext, POP_MS);
}

function hide() {
  clearTimeout(popTimer);
  popTimer = null;
  showing = false;
  $('#prPop').classList.add('hidden');
  $('#prConfetti').replaceChildren();
}

/** רטט קצר — מרגישים את השיא גם כשהעיניים על המוט */
function buzz() {
  try { navigator.vibrate?.([18, 60, 34]); } catch { /* לא נתמך בכל מכשיר */ }
}

/** תגית 🏆 לרשימות (היסטוריית אימונים) */
export function prBadge(count) {
  if (!count) return null;
  return el('span', { class: 'pr-badge' },
    count === 1 ? '🏆 שיא' : `🏆 ${count} שיאים`);
}

export function initRecords() {
  // לחיצה על ההתראה מדלגת לשיא הבא בתור, או סוגרת
  $('#prPop').addEventListener('click', showNext);
}
