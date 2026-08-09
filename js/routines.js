/* ===================================================================
   routines.js — תוכניות אימון בשם (אימון A, אימון B...) ושיבוץ שלהן
   לימי השבוע. מתוך תוכנית מתחילים אימון עם התרגילים כבר מוכנים.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, closeSheet, confirmSheet, heCount, guard, keepScroll, dateKey, shiftDateKey,
} from './ui.js';

const SCHEDULE_KEY = 'weekSchedule';

/** וי חד וקווי (לא תו טקסט מעוגל) — לתג היום שבוצע ולתגית "בוצע!" */
function checkIcon(className) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  const poly = document.createElementNS(NS, 'polyline');
  poly.setAttribute('points', '4,13 9,18 20,6');
  svg.appendChild(poly);
  return svg;
}

/** ראשון=0 ... שבת=6 */
export const DAY_NAMES  = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const DAY_SHORT  = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

let routinesCache = null;
let scheduleCache = null;
let onStart = null;   // callback: התחל אימון מתוך תוכנית
let onRoutinesChanged = null;
let onCheckDoneToday = null;  // callback: האם התוכנית הזו כבר בוצעה היום (מוזרק מ-app.js, נמנע תלות מעגלית ב-workouts.js)
let onCheckDoneOnDate = null; // callback: האם התוכנית הזו בוצעה בתאריך נתון (למעקב השבועי)

/* ---------- מודל ---------- */

function newRoutine(name = '') {
  return { id: db.uid(), kind: 'strength', name, note: '', exercises: [], order: Date.now(), createdAt: Date.now() };
}

function newPlanExercise(name = '') {
  return { id: db.uid(), name, sets: 3, reps: '8-12', weight: '' };
}

/** מאפס את המטמון — נדרש אחרי ייבוא גיבוי, שמשנה את המסד מתחת לרגליים */
export function invalidateRoutinesCache() {
  routinesCache = null;
  scheduleCache = null;
}

/**
 * תוכניות כוח בלבד. סוגי האירובי יושבים באותו מאגר עם kind='cardio'
 * ומנוהלים ב-cardio.js — רשומה ישנה בלי kind היא תוכנית כוח.
 */
export async function getRoutines() {
  if (!routinesCache) {
    const all = await db.getAll(db.STORES.routines);
    routinesCache = all
      .filter((r) => (r.kind ?? 'strength') === 'strength')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return routinesCache;
}

export async function getRoutine(id) {
  return (await getRoutines()).find((r) => r.id === id) || null;
}

async function saveRoutine(routine) {
  await db.put(db.STORES.routines, routine);
  routinesCache = null;
  onRoutinesChanged?.();
}

async function deleteRoutine(id) {
  await db.del(db.STORES.routines, id);
  routinesCache = null;
  // מנקים שיבוצים שהצביעו על התוכנית שנמחקה
  const schedule = await getSchedule();
  let touched = false;
  for (let i = 0; i < 7; i++) {
    if (schedule[i] === id) { schedule[i] = null; touched = true; }
  }
  if (touched) await setSchedule(schedule);
  onRoutinesChanged?.();
}

/* ---------- לוח שבועי ---------- */

export async function getSchedule() {
  if (!scheduleCache) {
    const saved = await db.getSetting(SCHEDULE_KEY, null);
    scheduleCache = Array.isArray(saved) && saved.length === 7 ? saved : [null, null, null, null, null, null, null];
  }
  return scheduleCache;
}

async function setSchedule(schedule) {
  scheduleCache = schedule;
  await db.setSetting(SCHEDULE_KEY, schedule);
}

/** התוכנית המשובצת ליום נתון (ברירת מחדל: היום) */
export async function routineForDay(dayIndex = new Date().getDay()) {
  const schedule = await getSchedule();
  const id = schedule[dayIndex];
  return id ? await getRoutine(id) : null;
}

/* ---------- תצוגה ---------- */

export async function renderPlan() {
  const [routines, schedule] = await Promise.all([getRoutines(), getSchedule()]);
  const today = new Date().getDay();
  const todayRoutine = schedule[today] ? routines.find((r) => r.id === schedule[today]) : null;

  await renderTodayCard(todayRoutine, today, routines);
  await renderWeekStrip(routines, schedule, today);
  renderRoutineList(routines, schedule);
}

async function renderTodayCard(routine, today, allRoutines = []) {
  const host = $('#todayCard');

  // יום עם אימון משובץ — כפתור אחד גדול, והתרגילים גלויים מראש.
  // אם כבר בוצע היום בפועל — לא דוחפים להתחיל אותו שוב, מציגים "בוצע"
  if (routine) {
    const done = await onCheckDoneToday?.(routine.id);
    host.replaceChildren(
      el('div', { class: 'today-day' }, `היום · יום ${DAY_NAMES[today]}`),
      el('h2', { class: 'today-name' }, routine.name),
      routine.exercises.length
        ? el('ul', { class: 'today-exercises' },
            ...routine.exercises.map((e) => el('li', {},
              el('span', { class: 'te-name' }, e.name),
              el('span', { class: 'te-target' }, `${e.sets}×${e.reps || '—'}`))))
        : el('div', { class: 'today-sub' }, 'התוכנית ריקה — אפשר להוסיף תרגילים תוך כדי'),
      // בוצע כבר היום — לא נותנים אפשרות להתחיל את אותו אימון שוב, רק תגית סטטוס
      done
        ? el('div', { class: 'today-done-badge' }, 'בוצע!', checkIcon('today-done-icon'))
        : el('button', {
            class: 'btn btn-primary btn-xl',
            onclick: () => onStart?.(routine),
          }, `התחל ${routine.name}`),
      el('button', {
        class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
        onclick: () => onStart?.(null),
      }, 'אימון חופשי במקום'),
    );
    return;
  }

  // יום בלי שיבוץ — במקום לדחוף "אימון חופשי", מציעים את התוכניות שלו
  host.replaceChildren(
    el('div', { class: 'today-day' }, `היום · יום ${DAY_NAMES[today]}`),
    el('h2', { class: 'today-name' }, allRoutines.length ? 'איזה אימון היום?' : 'יום מנוחה'),

    allRoutines.length
      ? el('div', {},
          el('div', { class: 'today-sub' }, 'לא שיבצת אימון ליום הזה — בחר מה בא לך לעשות.'),
          el('div', { class: 'today-picks' },
            ...allRoutines.map((r) => el('button', {
              class: 'pick-card',
              onclick: () => onStart?.(r),
            },
              el('span', { class: 'pick-name' }, r.name),
              el('span', { class: 'pick-sub' },
                r.exercises.length
                  ? r.exercises.map((e) => e.name).join(' · ')
                  : 'בלי תרגילים מוגדרים'),
            )),
          ),
        )
      : el('div', { class: 'today-sub' },
          'עוד לא בנית תוכניות אימון. אפשר לבנות אותן בהגדרות ⚙️, או להתחיל אימון חופשי ולהוסיף תרגילים תוך כדי.'),

    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:12px',
      onclick: () => onStart?.(null),
    }, 'אימון חופשי'),
  );
}

/**
 * לוח השבוע — לתצוגה בלבד (השינוי נעשה דרך ההגדרות). כל יום שכבר בוצע בו
 * האימון המשובץ מקבל וי ירוק ישירות על התג שלו, לא ברשימה נפרדת.
 * hostId ניתן לשינוי כדי לרנדר את אותו הרכיב גם במסך הבית וגם במסך האימון.
 */
export async function renderWeekStrip(routines, schedule, today, hostId = 'weekStrip') {
  const host = $('#' + hostId);
  if (!host) return;
  const todayKey = dateKey();
  const weekStart = shiftDateKey(todayKey, -today);

  const days = await Promise.all(DAY_SHORT.map(async (short, i) => {
    const routine = schedule[i] ? routines.find((r) => r.id === schedule[i]) : null;
    const dayKey = shiftDateKey(weekStart, i);
    const done = routine && dayKey <= todayKey ? !!(await onCheckDoneOnDate?.(routine.id, dayKey)) : false;
    return { short, i, routine, done };
  }));

  host.replaceChildren(...days.map(({ short, i, routine, done }) => el('div', {
    class: `day-chip is-static${i === today ? ' is-today' : ''}${routine ? ' has-plan' : ''}${done ? ' is-done' : ''}`,
    'aria-label': `יום ${DAY_NAMES[i]}: ${routine ? routine.name : 'מנוחה'}${done ? ' — בוצע' : ''}`,
  },
    done ? checkIcon('day-check') : null,
    el('span', { class: 'day-letter' }, short),
    el('span', { class: 'day-plan' }, routine ? routine.name : 'מנוחה'),
  )));
}

function renderRoutineList(routines, schedule) {
  const host = $('#routineList');

  if (!routines.length) {
    host.replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📋'),
      el('p', { html: 'עדיין אין תוכניות.<br>צור "אימון A", "אימון B" וכו\', ושבץ אותן לימים.' })));
    return;
  }

  // במסך האימון אפשר רק להתחיל. עריכה נעשית דרך ההגדרות.
  host.replaceChildren(...routines.map((r) => {
    const days = schedule
      .map((id, i) => (id === r.id ? DAY_SHORT[i] : null))
      .filter(Boolean);
    return el('div', { class: 'list-item is-static' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, r.name),
        el('div', { class: 'li-sub' },
          `${heCount(r.exercises.length, 'תרגיל', 'תרגילים')}` +
          (days.length ? ` · ימים ${days.join(', ')}` : ' · לא משובץ')),
      ),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: () => onStart?.(r),
      }, 'התחל'),
    );
  }));
}

/* ---------- מסכי הגדרות ---------- */

/** רשימת התוכניות לעריכה — נפתח מההגדרות בלבד */
export async function openRoutinesListSheet() {
  const [routines, schedule] = await Promise.all([getRoutines(), getSchedule()]);

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'כל תוכנית היא רשימת תרגילים קבועה. בזמן אימון אפשר להוסיף תרגיל חד־פעמי בלי שזה ישנה את התוכנית.'),

    routines.length
      ? el('div', { class: 'list' }, ...routines.map((r) => {
          const days = schedule.map((id, i) => (id === r.id ? DAY_SHORT[i] : null)).filter(Boolean);
          return el('div', {
            class: 'list-item',
            onclick: () => { closeSheet(); openRoutineEditor(r); },
          },
            el('div', { class: 'li-main' },
              el('div', { class: 'li-title' }, r.name),
              el('div', { class: 'li-sub' },
                `${heCount(r.exercises.length, 'תרגיל', 'תרגילים')}` +
                (days.length ? ` · ימים ${days.join(', ')}` : ' · לא משובץ')),
            ),
            el('div', { class: 'si-arrow' }, '‹'),
          );
        }))
      : el('div', { class: 'empty-state' },
          el('div', { class: 'empty-icon' }, '📋'),
          el('p', { html: 'עדיין אין תוכניות.<br>צור "אימון A", "אימון B" וכו\'.' })),

    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:16px',
      onclick: () => { closeSheet(); openRoutineEditor(null); },
    }, '+ תוכנית חדשה'),
  );

  openSheet('תוכניות אימון', body);
}

/** שיבוץ שבועי — נפתח מההגדרות בלבד */
export async function openScheduleSheet() {
  const [routines, schedule] = await Promise.all([getRoutines(), getSchedule()]);
  const today = new Date().getDay();

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'איזה אימון משובץ לכל יום. אתה תמיד יכול להתחיל אימון אחר — השיבוץ הוא רק ברירת המחדל.'),
    el('div', { class: 'list' }, ...DAY_NAMES.map((name, i) => {
      const r = schedule[i] ? routines.find((x) => x.id === schedule[i]) : null;
      return el('div', {
        class: `list-item${i === today ? ' is-selected' : ''}`,
        onclick: () => { closeSheet(); openDayPicker(i); },
      },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `יום ${name}${i === today ? ' · היום' : ''}`),
          el('div', { class: 'li-sub' }, r ? r.name : 'יום מנוחה'),
        ),
        el('div', { class: 'si-arrow' }, '‹'),
      );
    })),
  );

  openSheet('שיבוץ לימי השבוע', body);
}

/* ---------- שיבוץ יום ---------- */

async function openDayPicker(dayIndex) {
  const routines = await getRoutines();
  const schedule = await getSchedule();
  const current = schedule[dayIndex];

  let picked = false;
  const pick = async (id) => {
    if (picked) return;
    picked = true;
    schedule[dayIndex] = id;
    await setSchedule([...schedule]);
    closeSheet();
    await renderPlan();
    onRoutinesChanged?.();
    toast(id ? 'שובץ' : 'סומן כיום מנוחה', 'ok');
    openScheduleSheet();   // חוזרים לרשימת הימים, כדי לשבץ עוד
  };

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' }, 'איזה אימון אתה עושה ביום הזה?'),
    el('div', { class: 'list' },
      ...routines.map((r) => el('div', {
        class: `list-item${current === r.id ? ' is-selected' : ''}`,
        onclick: () => pick(r.id),
      },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, r.name),
          el('div', { class: 'li-sub' }, r.exercises.map((e) => e.name).join(' · ') || 'תוכנית ריקה'),
        ),
        current === r.id ? el('div', { class: 'li-side' }, '✓') : null,
      )),
      el('div', {
        class: `list-item${!current ? ' is-selected' : ''}`,
        onclick: () => pick(null),
      },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'יום מנוחה')),
        !current ? el('div', { class: 'li-side' }, '✓') : null,
      ),
    ),
    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:14px',
      onclick: () => { closeSheet(); openRoutineEditor(null); },
    }, '+ צור תוכנית חדשה'),
  );

  openSheet(`יום ${DAY_NAMES[dayIndex]}`, body);
}

/* ---------- עורך תוכנית ---------- */

export function openRoutineEditor(existing = null) {
  const routine = existing
    ? JSON.parse(JSON.stringify(existing))     // עותק, כדי ש"ביטול" לא ישנה כלום
    : newRoutine('');

  const listHost = el('div', { class: 'plan-ex-list' });

  const renderList = () => keepScroll(listHost, () => {
    if (!routine.exercises.length) {
      listHost.replaceChildren(el('div', { class: 'empty-state', style: 'padding:20px' },
        el('p', {}, 'הוסף את התרגילים של האימון הזה')));
      return;
    }
    listHost.replaceChildren(...routine.exercises.map((ex, i) => el('div', { class: 'plan-ex' },
      el('div', { class: 'plan-ex-idx' }, String(i + 1)),
      el('div', { class: 'plan-ex-main' },
        el('input', {
          type: 'text', value: ex.name, placeholder: 'שם תרגיל',
          oninput: (e) => { ex.name = e.target.value; },
        }),
        el('div', { class: 'plan-ex-targets' },
          el('input', {
            type: 'number', inputmode: 'numeric', min: '1', max: '20', value: ex.sets,
            'aria-label': 'מספר סטים',
            oninput: (e) => { ex.sets = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)); },
          }),
          el('span', {}, 'סטים ×'),
          el('input', {
            type: 'text', value: ex.reps, placeholder: '8-12',
            'aria-label': 'טווח חזרות',
            oninput: (e) => { ex.reps = e.target.value; },
          }),
          el('span', {}, 'חזרות'),
        ),
        el('div', { class: 'plan-ex-targets' },
          el('input', {
            type: 'text', inputmode: 'decimal', value: ex.weight ?? '', placeholder: '—',
            'aria-label': 'משקל התחלתי',
            oninput: (e) => { ex.weight = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'); },
          }),
          el('span', {}, 'ק"ג משקל התחלתי (אם אין היסטוריה)'),
        ),
      ),
      el('div', { class: 'plan-ex-actions' },
        el('button', {
          class: 'icon-btn', 'aria-label': 'העלה למעלה', disabled: i === 0,
          onclick: () => { [routine.exercises[i - 1], routine.exercises[i]] = [routine.exercises[i], routine.exercises[i - 1]]; renderList(); },
        }, '↑'),
        el('button', {
          class: 'icon-btn', 'aria-label': 'מחק תרגיל',
          onclick: () => { routine.exercises.splice(i, 1); renderList(); },
        }, '✕'),
      ),
    )));
  });
  renderList();

  const nameInput = el('input', {
    id: 'routineName', type: 'text', value: routine.name,
    placeholder: 'למשל: אימון A — חזה וכתפיים',
  });

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', { for: 'routineName' }, 'שם האימון'), nameInput),
    el('div', { class: 'field' },
      el('label', {}, 'תרגילים'),
      listHost,
      el('button', {
        class: 'add-set-btn', style: 'margin-top:10px',
        onclick: () => {
          routine.exercises.push(newPlanExercise(''));
          renderList();
          listHost.querySelector('.plan-ex:last-child input')?.focus();
        },
      }, '+ תרגיל'),
    ),
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        routine.name = nameInput.value.trim();
        if (!routine.name) { toast('תן שם לאימון', 'err'); nameInput.focus(); return; }
        routine.exercises = routine.exercises.filter((ex) => ex.name.trim());
        for (const ex of routine.exercises) ex.name = ex.name.trim();
        await saveRoutine(routine);
        closeSheet();
        await renderPlan();
        toast('התוכנית נשמרה', 'ok');
      }),
    }, existing ? 'שמור שינויים' : 'צור תוכנית'),

    existing ? el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
      onclick: async () => {
        const ok = await confirmSheet('מחיקת תוכנית', `למחוק את "${existing.name}"? האימונים שכבר ביצעת יישארו.`, 'מחק');
        if (!ok) return;
        await deleteRoutine(existing.id);
        await renderPlan();
        toast('התוכנית נמחקה');
      },
    }, 'מחק תוכנית') : null,
  );

  openSheet(existing ? 'עריכת תוכנית' : 'תוכנית חדשה', body);
}

/* ---------- אתחול ---------- */

export async function initRoutines({ onStartWorkout, onUpdate, isDoneToday, isDoneOnDate } = {}) {
  onStart = onStartWorkout;
  onRoutinesChanged = onUpdate;
  onCheckDoneToday = isDoneToday;
  onCheckDoneOnDate = isDoneOnDate;
  await renderPlan();
}
