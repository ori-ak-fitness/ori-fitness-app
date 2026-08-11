/* ===================================================================
   workouts.js — יומן אימונים: טיימר חי, תרגילים חופשיים,
   סטים עם מעבר אוטומטי בין שדות, וסיכום אוטומטי בסיום.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, closeSheet, confirmSheet, confetti,
  dateKey, formatDateHe, formatDuration, formatDurationHe, formatTime,
  num, fmtNum, heCount, guard, keepScroll, attachAutoAdvance,
} from './ui.js';
import { getRoutines } from './routines.js';
import {
  isSetDone, liftedWeight, liftedReps, bestWeightByExercise, bestRepsByExercise, prSetsByWorkout,
  announcePR, dismissPR, prBadge, initRecords,
} from './records.js';

const ACTIVE_KEY = 'activeWorkout';

let active = null;        // האימון הפעיל (נשמר גם ב-IndexedDB)
let timerId = null;       // setInterval של הטיימר
let saveTimer = null;     // debounce לשמירה
let onWorkoutSaved = null; // callback לרענון מסכים אחרים
let prBest = new Map();   // שם תרגיל -> השיא במשקל לפני הסט הבא (ראה checkPR)
let repBest = new Map();  // שם תרגיל -> השיא בחזרות לפני הסט הבא
let prCheckTimer = null;  // debounce לבדיקת שיא תוך כדי הקלדה
let onGetReminder = null; // מספק את הציטוט/הבטחה הנוכחיים (dashboard.js, דרך callback כדי לא ליצור תלות מעגלית)
let reminderText = '';    // נטען פעם אחת בכניסה לאימון, לא בכל רינדור

/* ---------- מודל ---------- */

function newWorkout(routine = null, lastByExercise = new Map()) {
  return {
    id: db.uid(),
    kind: 'strength',
    date: dateKey(),
    startedAt: Date.now(),
    endedAt: null,
    routineId: routine?.id ?? null,
    routineName: routine?.name ?? null,
    // תוכנית טוענת את התרגילים מראש, והמשקלים מגיעים ממה שהרמת בפעם
    // הקודמת — נכנסים לאימון ורק מתקנים אם עלית.
    exercises: (routine?.exercises ?? []).map((ex) => {
      const last = lastByExercise.get(ex.name);
      const count = Math.max(1, ex.sets || 1);
      return {
        id: db.uid(),
        name: ex.name,
        targetReps: ex.reps || '',
        lastTime: last ? { date: last.date, summary: summarizeSets(last.sets) } : null,
        sets: Array.from({ length: count }, (_, i) => {
          const s = newSet();
          // קודם מה שהרמת בפועל בפעם הקודמת (אותו סט, ואם אין — האחרון),
          // ורק אם אין היסטוריה בכלל — המשקל ההתחלתי מהתוכנית
          const ref = last?.sets[i] ?? last?.sets[last.sets.length - 1];
          if (ref?.weight) s.weight = ref.weight;
          else if (ex.weight) s.weight = String(ex.weight);
          return s;
        }),
      };
    }),
  };
}

function newExercise(name) {
  return { id: db.uid(), name: name.trim(), targetReps: '', lastTime: null, sets: [newSet()] };
}

function newSet() {
  return { id: db.uid(), weight: '', reps: '', done: false };
}

/** סט נחשב "מלא" כשיש בו גם משקל וגם חזרות (משקל 0 תקף — מתח, בטן) */
function setHasData(s) {
  return String(s.weight ?? '').trim() !== '' && num(s.reps, 0) > 0;
}

/** נפח = סכום (משקל × חזרות) על כל הסטים */
export function calcVolume(workout) {
  let volume = 0;
  for (const ex of workout.exercises) {
    for (const s of ex.sets) {
      if (!isSetDone(s)) continue;
      const w = num(s.weight, 0), r = num(s.reps, 0);
      if (w > 0 && r > 0) volume += w * r;
    }
  }
  return Math.round(volume);
}

export function countSets(workout) {
  return workout.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter(isSetDone).length, 0);
}

function elapsedSec(workout) {
  return Math.floor(((workout.endedAt || Date.now()) - workout.startedAt) / 1000);
}

/* ---------- שמירה ---------- */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (active) db.setSetting(ACTIVE_KEY, active).catch(() => toast('שגיאה בשמירה', 'err'));
  }, 350);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (active) await db.setSetting(ACTIVE_KEY, active);
}

/* ---------- טיימר ---------- */

function tickTimer() {
  if (!active) return;
  const txt = formatDuration(elapsedSec(active));
  $('#bigTimer').textContent = txt;
  $('#liveTimerText').textContent = txt;
}

function startTimer() {
  stopTimer();
  tickTimer();
  timerId = setInterval(tickTimer, 1000);
  $('#liveTimerChip').classList.remove('hidden');
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  $('#liveTimerChip').classList.add('hidden');
}

/** טוען פעם אחת בכניסה לאימון — לא בכל רינדור, כדי לא לקרוא ל-DB שוב ושוב */
async function loadReminder() {
  try {
    const q = await onGetReminder?.();
    reminderText = q?.text || '';
  } catch {
    reminderText = '';
  }
}

/* ---------- שיאים אישיים ---------- */

/**
 * טוען את השיאים מההיסטוריה, ומעדכן אותם גם לפי מה שכבר סומן באימון
 * הפעיל — כך שסגירה ופתיחה של האפליקציה באמצע אימון לא מקפיצות שוב
 * התראה על שיא שכבר חגגת עליו.
 */
async function refreshPRBaseline() {
  const history = await getStrengthWorkouts();
  prBest = bestWeightByExercise(history);
  repBest = bestRepsByExercise(history);
  if (!active) return;
  for (const ex of active.exercises) {
    for (const s of ex.sets) {
      const weight = liftedWeight(s);
      if (weight > (prBest.get(ex.name) ?? 0)) prBest.set(ex.name, weight);
      const reps = liftedReps(s);
      if (reps > (repBest.get(ex.name) ?? 0)) repBest.set(ex.name, reps);
    }
  }
}

/**
 * בודק אם הסט שזה עתה סומן שבר שיא בתרגיל — במשקל, בחזרות, או שניהם —
 * ואם כן מקפיץ 🏆 (אחת או שתי התראות ברצף, דרך התור ב-records.js).
 * תרגיל שנעשה בפעם הראשונה רק קובע את הרף ולא נחשב שיא, אחרת כל
 * תרגיל חדש היה מתפוצץ בהתראה.
 * @returns {boolean} האם נשבר שיא כלשהו
 */
function checkPR(ex, set) {
  let broke = false;

  const weight = liftedWeight(set);
  if (weight) {
    const prevW = prBest.get(ex.name);
    if (prevW === undefined) {
      prBest.set(ex.name, weight);
    } else if (weight > prevW) {
      prBest.set(ex.name, weight);
      set.isPR = true;
      announcePR({ name: ex.name, kind: 'weight', value: weight, prev: prevW });
      broke = true;
    }
  }

  // שיא חזרות נבדק בכל משקל — לא רק באותו משקל בדיוק. יותר חזרות
  // בכל משקל שהוא זה עדיין התקדמות שראוי לציין.
  const reps = liftedReps(set);
  if (reps) {
    const prevR = repBest.get(ex.name);
    if (prevR === undefined) {
      repBest.set(ex.name, reps);
    } else if (reps > prevR) {
      repBest.set(ex.name, reps);
      set.isPR = true;
      announcePR({ name: ex.name, kind: 'reps', value: reps, prev: prevR });
      broke = true;
    }
  }

  return broke;
}

/**
 * בזמן הקלדה המשקל עובר דרך ערכי ביניים ("1" בדרך ל-"120") — בודקים
 * שיא רק אחרי שהאצבע נחה, כדי שלא יקפצו כמה התראות על אותו סט.
 */
function schedulePRCheck(exId, setId) {
  clearTimeout(prCheckTimer);
  prCheckTimer = setTimeout(() => {
    const { ex, set } = findSet(exId, setId);
    if (!ex || !set || !isSetDone(set)) return;
    if (!checkPR(ex, set)) return;
    // עדכון נקודתי של הכרטיס — רינדור מלא היה גוזל את הפוקוס מהשדה
    const row = $(`#exerciseList .set-row[data-set="${set.id}"]`);
    row?.classList.add('is-pr');
    const meta = row?.closest('.exercise-card')?.querySelector('.exercise-meta');
    if (meta) meta.textContent = exerciseMetaText(ex);
    saveNow();
  }, 800);
}

/** מספר הסטים ששברו שיא באימון (מתוך הדגלים שנרשמו בזמן אמת) */
function countPRs(workout) {
  return workout.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => s.isPR).length, 0);
}

/* ---------- תצוגה: אימון פעיל ---------- */

function renderActive() {
  const idle = $('#workoutIdle');
  const act = $('#workoutActive');

  if (!active) {
    idle.classList.remove('hidden');
    act.classList.add('hidden');
    stopTimer();
    return;
  }

  idle.classList.add('hidden');
  act.classList.remove('hidden');
  $('#activeRoutineName').textContent = active.routineName || 'אימון חופשי';

  const reminderEl = $('#workoutReminder');
  reminderEl.textContent = reminderText;
  reminderEl.classList.toggle('hidden', !reminderText);

  const host = $('#exerciseList');
  // בלי keepScroll, כל הוספת סט/תרגיל הייתה מקפיצה את העמוד לראשו
  keepScroll(host, () => {
    host.replaceChildren(...active.exercises.map(renderExerciseCard));

    if (!active.exercises.length) {
      host.append(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '💪'),
        el('p', { html: 'אין עדיין תרגילים.<br>לחץ "+ תרגיל" למטה כדי להוסיף.' })));
    }
  });

  $('#activeSets').textContent = String(countSets(active));
  tickTimer();
}

/** שורת המידע מתחת לשם התרגיל — מתעדכנת גם תוך כדי הקלדה */
function exerciseMetaText(ex) {
  const doneSets = ex.sets.filter(isSetDone);
  const best = doneSets.length ? Math.max(...doneSets.map((s) => num(s.weight, 0))) : 0;
  const allDone = doneSets.length === ex.sets.length && ex.sets.length > 0;
  return `${allDone ? '✓ ' : ''}${doneSets.length}/${ex.sets.length} סטים` +
    `${ex.targetReps ? ` · יעד ${ex.targetReps} חזרות` : ''}` +
    `${best ? ` · מקס' ${fmtNum(best, 1)} ק"ג` : ''}` +
    `${ex.sets.some((s) => s.isPR) ? ' · 🏆 שיא חדש' : ''}`;
}

function renderExerciseCard(ex) {
  const card = el('div', { class: 'exercise-card', dataset: { ex: ex.id } },
    el('div', { class: 'exercise-head' },
      el('div', { style: 'min-width:0' },
        el('div', { class: 'exercise-name' }, ex.name),
        el('div', { class: 'exercise-meta' }, exerciseMetaText(ex)),
        ex.lastTime
          ? el('div', { class: 'last-time' },
              el('span', { class: 'last-time-tag' }, 'פעם שעברה'),
              `${ex.lastTime.summary} · ${formatDateHe(ex.lastTime.date)}`)
          : null,
      ),
      el('button', {
        class: 'icon-btn', 'aria-label': 'מחק תרגיל',
        onclick: guard(() => removeExercise(ex.id)),
      }, '🗑'),
    ),
    el('div', { class: 'set-head' },
      el('span', {}, '#'), el('span', {}, 'משקל (ק"ג)'), el('span', {}, 'חזרות'),
      el('span', { style: 'text-align:center' }, 'בוצע'), el('span', {}),
    ),
    el('div', { class: 'set-table' }, ...ex.sets.map((s, i) => renderSetRow(ex, s, i))),
    el('button', { class: 'add-set-btn', onclick: () => addSet(ex.id) }, '+ סט'),
  );
  return card;
}

function renderSetRow(ex, set, index) {
  // המשקל מגיע מהפעם הקודמת/מהתוכנית, החזרות מהיעד — כך אפשר
  // לסמן ✓ בלי להקליד כלום כשהסט בוצע בדיוק כמתוכנן.
  const targetReps = firstNumber(ex.targetReps);

  const mkInput = (field, placeholder, mode) => el('input', {
    type: 'text',
    inputmode: mode,
    enterkeyhint: 'next',
    autocomplete: 'off',
    placeholder,
    value: set[field] ?? '',
    class: set[field] ? 'filled' : '',
    'data-advance': '',
    dataset: { ex: ex.id, set: set.id, field },
    oninput: (e) => onSetInput(e.target),
  });

  return el('div', {
    class: `set-row${set.done ? ' is-done' : ''}${set.isPR ? ' is-pr' : ''}`,
    dataset: { set: set.id },
  },
    el('div', { class: 'set-idx' }, String(index + 1)),
    mkInput('weight', set.weight ? '' : '0', 'decimal'),
    mkInput('reps', targetReps ? String(targetReps) : '0', 'numeric'),
    el('button', {
      class: `set-check${set.done ? ' is-done' : ''}`,
      'aria-label': set.done ? 'בטל סימון סט' : 'סמן סט כבוצע',
      'aria-pressed': set.done ? 'true' : 'false',
      onclick: () => toggleSetDone(ex.id, set.id, targetReps),
    }, set.done ? '✓' : ''),
    el('button', {
      class: 'icon-btn set-del', 'aria-label': 'מחק סט',
      onclick: () => removeSet(ex.id, set.id),
    }, '✕'),
  );
}

/** "8-12" -> 8, "10" -> 10, "" -> null */
function firstNumber(text) {
  const m = String(text ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * סימון ידני של סט. אם השדות ריקים, ממלא אותם מהיעד — ככה אפשר
 * לבצע סט בדיוק כמתוכנן ולסמן ✓ בלחיצה אחת בלי הקלדה.
 */
function toggleSetDone(exId, setId, targetReps) {
  const { ex, set } = findSet(exId, setId);
  if (!set) return;

  if (set.done) {
    set.done = false;
    // ביטול סימון מוריד גם את סימון השיא. הרף עצמו (prBest) נשאר —
    // מי שהרים 100 לא "מאבד" את השיא כי לחץ על הוי בטעות.
    delete set.isPR;
  } else {
    if (String(set.weight ?? '').trim() === '') {
      // משקל מסט קודם באותו תרגיל, אם יש
      const prev = ex.sets.slice(0, ex.sets.indexOf(set)).reverse()
        .find((s) => String(s.weight ?? '').trim() !== '');
      if (prev) set.weight = prev.weight;
    }
    if (num(set.reps, 0) <= 0 && targetReps) set.reps = String(targetReps);
    set.done = true;
    checkPR(ex, set);
  }

  saveNow();
  renderActive();
}

/* ---------- עריכת נתונים ---------- */

function findSet(exId, setId) {
  const ex = active?.exercises.find((e) => e.id === exId);
  return { ex, set: ex?.sets.find((s) => s.id === setId) };
}

function onSetInput(input) {
  const { ex: exId, set: setId, field } = input.dataset;
  const { ex, set } = findSet(exId, setId);
  if (!set) return;

  // מאפשרים רק ספרות ונקודה/פסיק אחת
  let v = input.value.replace(/[^\d.,]/g, '').replace(',', '.');
  const parts = v.split('.');
  if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
  if (field === 'reps') v = v.replace(/\./g, '');
  if (v !== input.value) input.value = v;

  set[field] = v;
  input.classList.toggle('filled', v !== '');

  // וי אוטומטי ברגע שיש גם משקל וגם חזרות. אם מחקת אחד מהם — הוי יורד,
  // אלא אם סימנת ידנית ואז מחקת, מקרה שממילא לא נשאר "בוצע".
  const nowDone = setHasData(set);
  if (set.done !== nowDone) {
    set.done = nowDone;
    const row = input.closest('.set-row');
    if (row) {
      row.classList.toggle('is-done', nowDone);
      const check = row.querySelector('.set-check');
      if (check) {
        check.textContent = nowDone ? '✓' : '';
        check.classList.toggle('is-done', nowDone);
        check.setAttribute('aria-pressed', nowDone ? 'true' : 'false');
      }
    }
  }

  // בדיקת שיא: כל עוד יש בסט משקל וחזרות, גם אם הוא כבר היה מסומן —
  // תיקון המשקל כלפי מעלה הוא בדיוק המקרה שבו נשבר שיא.
  if (nowDone) {
    schedulePRCheck(exId, setId);
  } else if (set.isPR) {
    clearTimeout(prCheckTimer);
    delete set.isPR;
    input.closest('.set-row')?.classList.remove('is-pr');
  }

  // עדכון מיידי של הסיכום החי, בלי לרנדר מחדש (כדי לא לאבד פוקוס)
  $('#activeSets').textContent = String(countSets(active));
  const meta = input.closest('.exercise-card')?.querySelector('.exercise-meta');
  if (meta && ex) meta.textContent = exerciseMetaText(ex);
  scheduleSave();
}

async function addExercise(name) {
  if (!active) return;
  const clean = name.trim();
  if (!clean) { toast('כתוב שם תרגיל', 'err'); return; }
  const ex = newExercise(clean);

  // גם תרגיל שנוסף באמצע האימון מקבל את המשקל מהפעם הקודמת
  const last = (await lastPerformanceByExercise()).get(clean);
  if (last) {
    ex.lastTime = { date: last.date, summary: summarizeSets(last.sets) };
    if (last.sets[0]?.weight) ex.sets[0].weight = last.sets[0].weight;
  }

  active.exercises.push(ex);
  saveNow();
  renderActive();

  // גוללים לתרגיל החדש ונותנים פוקוס לשדה המשקל שלו
  const card = $(`#exerciseList .exercise-card[data-ex="${ex.id}"]`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card?.querySelector('input[data-field="weight"]')?.focus();
}

/**
 * הוספת תרגיל דרך גיליון — כך שהיא זמינה מכל מקום במסך,
 * בלי לגלול לתחתית מתחת לכל הסטים.
 */
async function openAddExerciseSheet() {
  const names = await usedExerciseNames();

  const input = el('input', {
    type: 'text', id: 'newExerciseName', placeholder: 'למשל: פולי עליון',
    autocomplete: 'off', enterkeyhint: 'done', list: 'exerciseSuggestions',
  });

  // הגנה מהקשה כפולה: אחרי שליחה אחת הגיליון נסגר ולא מקבל עוד קלט
  let submitted = false;
  const submit = () => {
    if (submitted) return;
    const value = input.value.trim();
    if (!value) { toast('כתוב שם תרגיל', 'err'); input.focus(); return; }
    submitted = true;
    closeSheet();
    addExercise(value);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', { for: 'newExerciseName' }, 'שם התרגיל'), input),
    names.length ? el('div', { class: 'chip-row' },
      ...names.slice(0, 12).map((n) => el('button', {
        class: 'chip', onclick: () => { input.value = n; submit(); },
      }, n)),
    ) : null,
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:8px', onclick: submit }, 'הוסף תרגיל'),
  );

  openSheet('תרגיל חדש', body);
  setTimeout(() => input.focus(), 120);
}

async function removeExercise(exId) {
  const ex = active?.exercises.find((e) => e.id === exId);
  if (!ex) return;
  const ok = await confirmSheet('מחיקת תרגיל', `למחוק את "${ex.name}" מהאימון?`, 'מחק');
  if (!ok) return;
  active.exercises = active.exercises.filter((e) => e.id !== exId);
  await saveNow();
  renderActive();
}

function addSet(exId) {
  const ex = active?.exercises.find((e) => e.id === exId);
  if (!ex) return;
  // סט חדש יורש את המשקל האחרון — חוסך הקלדה
  const prev = ex.sets[ex.sets.length - 1];
  const s = newSet();
  if (prev && prev.weight) s.weight = prev.weight;
  ex.sets.push(s);
  saveNow();
  renderActive();
  const row = $(`#exerciseList .set-row[data-set="${s.id}"]`);
  row?.querySelector('input[data-field="reps"]')?.focus();
}

function removeSet(exId, setId) {
  const ex = active?.exercises.find((e) => e.id === exId);
  if (!ex) return;
  if (ex.sets.length === 1) { toast('חייב להישאר לפחות סט אחד', 'err'); return; }
  ex.sets = ex.sets.filter((s) => s.id !== setId);
  saveNow();
  renderActive();
}

/* ---------- נעילת מסך בזמן אימון ---------- */

/*
 * באמצע סט אף אחד לא נוגע במסך, והטלפון מכבה אותו — צריך להעיר ולפתוח
 * שוב כדי לרשום חזרות. נעילת ההשכמה מונעת את זה כל עוד יש אימון פעיל.
 * לא נתמך בכל דפדפן, ולכן הכל עטוף — כישלון כאן לא אמור לשבור אימון.
 */
let wakeLock = null;

async function keepScreenAwake() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    // המערכת משחררת את הנעילה כשעוברים אפליקציה — צריך לבקש אותה מחדש
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* אין תמיכה או שהמשתמש חסם — לא קריטי */ }
}

async function releaseScreenLock() {
  try { await wakeLock?.release(); } catch { /* כבר שוחרר */ }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active) keepScreenAwake();
});

/* ---------- התחלה / סיום ---------- */

export async function startWorkout(routine = null) {
  if (active) { toast('כבר יש אימון פעיל'); return; }
  const lastByExercise = await lastPerformanceByExercise();
  active = newWorkout(routine, lastByExercise);
  await saveNow();
  await refreshPRBaseline();
  await loadReminder();
  renderActive();
  startTimer();
  keepScreenAwake();
  toast(routine ? `${routine.name} — יאללה! 💪` : 'בהצלחה! הטיימר רץ 💪', 'ok');
}

async function cancelWorkout() {
  const ok = await confirmSheet('ביטול אימון', 'האימון הפעיל יימחק ולא יישמר. להמשיך?', 'בטל אימון');
  if (!ok) return;
  active = null;
  dismissPR();
  await db.delSetting(ACTIVE_KEY);
  stopTimer();
  releaseScreenLock();
  renderActive();
  await renderHistory();
  toast('האימון בוטל');
}

async function finishWorkout() {
  if (!active) return;

  // ההתראה נסגרת לפני החגיגה, כדי ששתי שכבות-על לא יישבו זו על זו
  dismissPR();
  clearTimeout(prCheckTimer);

  const hasData = active.exercises.some((ex) => ex.sets.some(isSetDone));
  if (!hasData) {
    const ok = await confirmSheet('אימון ריק', 'לא הוזנו סטים. לסיים בכל זאת ולמחוק את האימון?', 'סיים ומחק');
    if (!ok) return;
    active = null;
    await db.delSetting(ACTIVE_KEY);
    stopTimer();
    releaseScreenLock();
    renderActive();
    return;
  }

  const finished = {
    ...active,
    endedAt: Date.now(),
    // שומרים רק סטים שבוצעו בפועל. סט שסומן ✓ נשמר גם אם המשקל בו 0
    // (מתח, מקבילים, תרגילי משקל גוף), וסט שלא סומן לא נכנס להיסטוריה.
    exercises: active.exercises
      .map((ex) => ({ ...ex, sets: ex.sets.filter(isSetDone) }))
      .filter((ex) => ex.sets.length > 0),
  };
  finished.durationSec = Math.floor((finished.endedAt - finished.startedAt) / 1000);
  finished.totalVolume = calcVolume(finished);
  finished.totalSets = countSets(finished);
  finished.exerciseCount = finished.exercises.length;
  finished.prCount = countPRs(finished);

  await db.put(db.STORES.workouts, finished);
  active = null;
  await db.delSetting(ACTIVE_KEY);
  stopTimer();
  releaseScreenLock();
  renderActive();
  await renderHistory();
  await refreshSuggestions();
  await showCelebration(finished);
  onWorkoutSaved?.();
}

/* ---------- חגיגה + סיכום ---------- */

// עם שם: {name} מוחלף בשם הפרטי. בלי שם: נופלים ל"אימון הושלם!" הרגיל.
const CELEBRATION_PHRASES = [
  'כל הכבוד, {name}! עוד אימון מאחוריך 💪',
  '{name}, זהו זה — סיימת חזק.',
  'אלוף, {name}! ככה עושים את זה.',
  '{name}, המשמעת שלך מדברת בעד עצמה.',
  'עוד ניצחון על עצמך, {name}.',
  '{name}, ככה בונים את הגרסה הבאה של עצמך.',
  'חזק, {name}! תרגיש את זה מחר 😅',
  '{name}, לא כולם היו עושים את זה היום. אתה כן.',
  'יאללה {name}, עוד אחד ברשימה.',
  '{name}, זה מה שמפריד בין רוצים לעושים.',
];

let lastPhraseIndex = -1;

function pickCelebrationPhrase(name) {
  let i = lastPhraseIndex;
  // לא בוחרים את אותה משפט פעמיים ברצף, גם אם יש רק כמה משפטים
  while (i === lastPhraseIndex) i = Math.floor(Math.random() * CELEBRATION_PHRASES.length);
  lastPhraseIndex = i;
  return CELEBRATION_PHRASES[i].replace('{name}', name);
}

async function showCelebration(w) {
  const name = (await db.getSetting('userName', '')).trim();
  $('#celebrationHeading').textContent = name ? pickCelebrationPhrase(name) : 'אימון הושלם!';

  const grid = $('#summaryGrid');
  grid.replaceChildren(
    // replaceChildren, בניגוד ל-el(), לא מסנן null בעצמו — צריך לסנן כאן
    // כדי שלא ייכנס node טקסט מילולי "null" כשאין שיא
    ...(w.prCount ? [el('div', { class: 'pr-note', style: 'grid-column:1/-1;margin:0' },
      w.prCount === 1 ? '🏆 שברת שיא אישי באימון הזה!' : `🏆 שברת ${w.prCount} שיאים אישיים באימון הזה!`)] : []),
    el('div', { class: 'sg' }, el('b', {}, formatDuration(w.durationSec)), el('span', {}, 'משך האימון')),
    el('div', { class: 'sg' }, el('b', {}, String(w.totalSets)), el('span', {}, w.totalSets === 1 ? 'סט' : 'סטים')),
    el('div', { class: 'sg' }, el('b', {}, String(w.exerciseCount)), el('span', {}, w.exerciseCount === 1 ? 'תרגיל' : 'תרגילים')),
  );
  $('#celebration').classList.remove('hidden');
  confetti($('#confettiHost'));
}

/* ---------- היסטוריה ---------- */

export async function getAllWorkouts() {
  const all = await db.getAll(db.STORES.workouts);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** אימוני כוח בלבד (אירובי נשמר באותו מאגר עם kind='cardio') */
export async function getStrengthWorkouts() {
  return (await getAllWorkouts()).filter((w) => (w.kind ?? 'strength') === 'strength');
}

/**
 * מה עשית בפעם הקודמת בכל תרגיל.
 * @returns {Map<string, {date:string, sets:{weight:string,reps:string}[]}>}
 */
export async function lastPerformanceByExercise() {
  const map = new Map();
  // מהחדש לישן — הראשון שנתקל בו הוא האחרון שבוצע
  for (const w of await getStrengthWorkouts()) {
    for (const ex of w.exercises) {
      if (map.has(ex.name)) continue;
      const sets = ex.sets.filter(isSetDone);
      if (sets.length) map.set(ex.name, { date: w.date, sets });
    }
  }
  return map;
}

/** תקציר קריא: "60×10 · 60×8 · 55×8" */
function summarizeSets(sets) {
  return sets.map((s) => `${s.weight}×${s.reps}`).join(' · ');
}

async function renderHistory() {
  const host = $('#workoutHistory');
  const all = await getAllWorkouts();

  if (!all.length) {
    host.replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏋️'),
      el('p', { html: 'עדיין לא רשמת אימונים.<br>לחץ "התחל אימון" כדי להתחיל.' })));
    return;
  }

  // השיאים מחושבים על כל ההיסטוריה בכל רינדור, ולא נשמרים על האימון —
  // כך מחיקת אימון או ייבוא גיבוי מזיזים את הסימונים לאימון הנכון.
  const prMap = prSetsByWorkout(all);

  host.replaceChildren(...all.slice(0, 25).map((w) => {
    // אירובי מוצג אחרת — אין לו נפח או סטים
    if (w.kind === 'cardio') {
      return el('div', { class: 'list-item', onclick: () => showCardioDetails(w) },
        el('div', { class: 'cardio-icon' }, w.icon || '🏃'),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `${w.name} · ${formatDateHe(w.date)}`),
          el('div', { class: 'li-sub' }, 'אירובי'),
        ),
        el('div', { class: 'li-side' },
          Math.round((w.durationSec ?? 0) / 60),
          el('small', {}, 'דקות'),
        ),
      );
    }

    const prIds = prMap.get(w.id) ?? null;

    return el('div', { class: 'list-item', onclick: () => showWorkoutDetails(w, prIds) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' },
          w.routineName ? `${w.routineName} · ${formatDateHe(w.date)}` : formatDateHe(w.date),
          prBadge(prIds?.size ?? 0)),
        el('div', { class: 'li-sub' },
          `${heCount(w.exerciseCount ?? w.exercises.length, 'תרגיל', 'תרגילים')} · ` +
          `${heCount(w.totalSets ?? countSets(w), 'סט', 'סטים')} · ${formatDurationHe(w.durationSec ?? 0)}`),
      ),
      el('div', { class: 'li-side' },
        String(w.totalSets ?? countSets(w)),
        el('small', {}, 'סטים'),
      ),
    );
  }));
}

function showCardioDetails(w) {
  const body = el('div', {},
    el('div', { class: 'summary-grid', style: 'margin-bottom:16px' },
      el('div', { class: 'sg' }, el('b', {}, String(Math.round((w.durationSec ?? 0) / 60))), el('span', {}, 'דקות')),
      el('div', { class: 'sg' }, el('b', {}, w.icon || '🏃'), el('span', {}, w.name)),
    ),
    el('p', { class: 'muted' }, formatDateHe(w.date, { withYear: true })),
    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:18px',
      onclick: guard(async () => {
        const ok = await confirmSheet('מחיקת אירובי', 'למחוק את הרישום?', 'מחק');
        if (!ok) return;
        await db.del(db.STORES.workouts, w.id);
        await renderHistory();
        onWorkoutSaved?.();
        toast('נמחק');
      }),
    }, 'מחק רישום'),
  );
  openSheet('אימון אירובי', body);
}

function showWorkoutDetails(w, prIds = null) {
  const prCount = prIds?.size ?? 0;

  const body = el('div', {},
    prCount ? el('div', { class: 'pr-note' },
      prCount === 1 ? '🏆 שיא אישי חדש באימון הזה' : `🏆 ${prCount} שיאים אישיים חדשים באימון הזה`) : null,
    el('div', { class: 'summary-grid', style: 'margin-bottom:16px' },
      el('div', { class: 'sg' }, el('b', {}, formatDuration(w.durationSec ?? 0)), el('span', {}, 'משך')),
      el('div', { class: 'sg' }, el('b', {}, String(w.totalSets ?? countSets(w))), el('span', {}, 'סטים')),
    ),
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      `${formatDateHe(w.date, { withYear: true })} · ${formatTime(w.startedAt)}–${w.endedAt ? formatTime(w.endedAt) : ''}`),
    ...w.exercises.map((ex) => el('div', { class: 'exercise-card' },
      el('div', { class: 'exercise-name' }, ex.name,
        prBadge(ex.sets.filter((s) => prIds?.has(s.id)).length)),
      el('div', { class: 'set-table', style: 'margin-top:8px' },
        ...ex.sets.map((s, i) => el('div', {
          class: `set-row${prIds?.has(s.id) ? ' is-pr' : ''}`,
          style: 'grid-template-columns:34px 1fr 1fr',
        },
          el('div', { class: 'set-idx' }, String(i + 1)),
          el('div', { class: 'set-idx', style: 'background:transparent' }, `${s.weight} ק"ג`),
          el('div', { class: 'set-idx', style: 'background:transparent' }, `${s.reps} חזרות`),
        )),
      ),
    )),
    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:18px',
      onclick: async () => {
        const ok = await confirmSheet('מחיקת אימון', 'למחוק את האימון לצמיתות?', 'מחק');
        if (!ok) return;
        await db.del(db.STORES.workouts, w.id);
        await renderHistory();
        onWorkoutSaved?.();
        toast('האימון נמחק');
      },
    }, 'מחק אימון'),
  );
  openSheet('פרטי אימון', body);
}

/* ---------- הצעות שמות תרגילים ---------- */

/** שמות תרגילים מהאימונים הקודמים ומהתוכניות, מהנפוץ לנדיר */
async function usedExerciseNames() {
  const all = await getStrengthWorkouts();
  const counts = new Map();
  for (const w of all) {
    for (const ex of w.exercises) counts.set(ex.name, (counts.get(ex.name) || 0) + 1);
  }
  for (const r of await getRoutines()) {
    for (const ex of r.exercises) if (!counts.has(ex.name)) counts.set(ex.name, 0);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

async function refreshSuggestions() {
  const names = await usedExerciseNames();
  $('#exerciseSuggestions').replaceChildren(...names.map((n) => el('option', { value: n })));
}

/* ---------- אתחול ---------- */

export async function initWorkouts({ onSaved, getReminder } = {}) {
  onWorkoutSaved = onSaved;
  onGetReminder = getReminder ?? null;

  // כל הפעולות האסינכרוניות עטופות ב-guard — הקשה כפולה מהירה
  // לא תפעיל אותן פעמיים (חגיגה כפולה, תרגיל כפול וכו')
  $('#finishWorkoutBtn').addEventListener('click', guard(finishWorkout));
  $('#cancelWorkoutBtn').addEventListener('click', guard(cancelWorkout));
  $('#addExerciseBtn').addEventListener('click', guard(openAddExerciseSheet));

  initRecords();

  $('#celebrationClose').addEventListener('click', () => {
    $('#celebration').classList.add('hidden');
    $('#confettiHost').replaceChildren();
  });

  // מעבר אוטומטי בין שדות: debounce בהקלדה + Enter/"הבא" במקלדת.
  // מוגבל לתרגיל הנוכחי בלבד — בסוף התרגיל נעצרים, כדי שלא "ניגררים"
  // לתרגיל הבא ולא נאבד שליטה על המסך.
  attachAutoAdvance($('#exerciseList'), (input) => {
    const card = input.closest('.exercise-card');
    if (!card) return null;
    const inputs = Array.from(card.querySelectorAll('input[data-advance]'));
    const i = inputs.indexOf(input);
    return i >= 0 && i < inputs.length - 1 ? inputs[i + 1] : null;
  });

  // שחזור אימון פעיל (למשל אחרי סגירת האפליקציה)
  const saved = await db.getSetting(ACTIVE_KEY, null);
  if (saved && saved.startedAt) {
    active = saved;
    await refreshPRBaseline();
    await loadReminder();
    renderActive();
    startTimer();
  } else {
    renderActive();
  }

  await renderHistory();
  await refreshSuggestions();

  // כשחוזרים לאפליקציה — לוודא שהטיימר מסונכרן
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active) tickTimer();
  });
}

export function hasActiveWorkout() { return !!active; }
export { renderHistory };
