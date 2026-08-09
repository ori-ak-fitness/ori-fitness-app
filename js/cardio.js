/* ===================================================================
   cardio.js — אימוני אירובי. מגדירים סוגים פעם אחת (ריצה, אופניים...),
   ואז מסמנים וי בלחיצה אחת, כמה פעמים שרוצים ביום, בנוסף לאימוני הכוח.
   התבניות נשמרות ב-routines עם kind='cardio'; הרישומים ב-workouts.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, closeSheet, confetti,
  dateKey, parseDateKey, shiftDateKey, formatDurationHe, num, fmtNum, guard, keepScroll,
} from './ui.js';
import { DAY_NAMES } from './routines.js';

/** ברירות מחדל שמוצעות למי שעוד לא הגדיר כלום */
const SUGGESTED = [
  { name: 'ריצה', minutes: 30, icon: '🏃' },
  { name: 'הליכון', minutes: 40, icon: '🚶' },
  { name: 'אופניים', minutes: 45, icon: '🚴' },
  { name: 'חבל קפיצה', minutes: 15, icon: '🪢' },
  { name: 'שחייה', minutes: 30, icon: '🏊' },
  { name: 'אליפטיקל', minutes: 30, icon: '🏋️' },
];

let templatesCache = null;
let onLogged = null;

/* ---------- תבניות ---------- */

export function invalidateCardioCache() { templatesCache = null; cardioScheduleCache = null; }

export async function getCardioTemplates() {
  if (!templatesCache) {
    const all = await db.getAll(db.STORES.routines);
    templatesCache = all
      .filter((r) => r.kind === 'cardio')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return templatesCache;
}

function newTemplate(name = '', minutes = 30, icon = '🏃') {
  return { id: db.uid(), kind: 'cardio', name, minutes, icon, weeklyGoal: 0, order: Date.now() };
}

/* ---------- שיבוץ לימי השבוע — כמו אימוני כוח, אבל נפרד ואופציונלי
   (לא מחליף את היעד השבועי החופשי, רק מוסיף "מה מתוכנן היום" לצפייה) ---------- */

const CARDIO_SCHEDULE_KEY = 'cardioWeekSchedule';
let cardioScheduleCache = null;

export async function getCardioSchedule() {
  if (!cardioScheduleCache) {
    const saved = await db.getSetting(CARDIO_SCHEDULE_KEY, null);
    cardioScheduleCache = Array.isArray(saved) && saved.length === 7 ? saved : [null, null, null, null, null, null, null];
  }
  return cardioScheduleCache;
}

async function setCardioSchedule(schedule) {
  cardioScheduleCache = schedule;
  await db.setSetting(CARDIO_SCHEDULE_KEY, schedule);
}

/** התבנית המשובצת ליום נתון (ברירת מחדל: היום), או null */
export async function cardioTemplateForDay(dayIndex = new Date().getDay()) {
  const [schedule, templates] = await Promise.all([getCardioSchedule(), getCardioTemplates()]);
  const id = schedule[dayIndex];
  return id ? (templates.find((t) => t.id === id) || null) : null;
}

/** שיבוץ אירובי לימי השבוע — נפתח מההגדרות בלבד, אותו דפוס כמו שיבוץ אימוני כוח */
export async function openCardioScheduleSheet() {
  const [templates, schedule] = await Promise.all([getCardioTemplates(), getCardioSchedule()]);

  if (!templates.length) {
    openSheet('שיבוץ אירובי', el('div', {},
      el('p', { class: 'muted' }, 'קודם צריך להגדיר לפחות סוג אירובי אחד.'),
      el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:12px',
        onclick: () => { closeSheet(); openCardioEditor(); },
      }, 'הגדר אירובי'),
    ));
    return;
  }

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'אפשר לשבץ סוג אירובי קבוע לימים מסוימים, בנוסף לאימוני הכוח — זה רק ברירת מחדל לצפייה, אפשר תמיד לסמן וי לסוג אחר.'),
    el('div', { class: 'list' }, ...DAY_NAMES.map((name, i) => {
      const t = schedule[i] ? templates.find((x) => x.id === schedule[i]) : null;
      return el('div', {
        class: 'list-item',
        onclick: () => { closeSheet(); openCardioDayPicker(i); },
      },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `יום ${name}`),
          el('div', { class: 'li-sub' }, t ? `${t.icon || '🏃'} ${t.name}` : 'לא משובץ'),
        ),
        el('div', { class: 'si-arrow' }, '‹'),
      );
    })),
  );

  openSheet('שיבוץ אירובי', body);
}

async function openCardioDayPicker(dayIndex) {
  const templates = await getCardioTemplates();
  const schedule = await getCardioSchedule();
  const current = schedule[dayIndex];

  let picked = false;
  const pick = async (id) => {
    if (picked) return;
    picked = true;
    schedule[dayIndex] = id;
    await setCardioSchedule([...schedule]);
    closeSheet();
    toast(id ? 'שובץ' : 'הוסר השיבוץ', 'ok');
    openCardioScheduleSheet();   // חוזרים לרשימת הימים, כדי לשבץ עוד
  };

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' }, 'איזה אירובי מתוכנן ליום הזה?'),
    el('div', { class: 'list' },
      ...templates.map((t) => el('div', {
        class: `list-item${current === t.id ? ' is-selected' : ''}`,
        onclick: () => pick(t.id),
      },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `${t.icon || '🏃'} ${t.name}`),
        ),
        current === t.id ? el('div', { class: 'li-side' }, '✓') : null,
      )),
      el('div', {
        class: `list-item${!current ? ' is-selected' : ''}`,
        onclick: () => pick(null),
      },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'בלי אירובי מתוכנן')),
        !current ? el('div', { class: 'li-side' }, '✓') : null,
      ),
    ),
  );

  openSheet(`יום ${DAY_NAMES[dayIndex]}`, body);
}

/* ---------- שבוע (ראשון–שבת, כמו לוח השבוע במסך האימונים) ---------- */

/** שבעת התאריכים של השבוע שמכיל את date, מתחילים ביום ראשון */
function weekDates(date = dateKey()) {
  const d = parseDateKey(date);
  const startOffset = -d.getDay();   // getDay(): ראשון=0
  const start = shiftDateKey(date, startOffset);
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(start, i));
}

/** כל רישומי האירובי של השבוע הנוכחי, לכל התבניות */
async function cardioThisWeek() {
  const dates = weekDates();
  const perDay = await Promise.all(dates.map((d) => cardioForDate(d)));
  return perDay.flat();
}

/**
 * תקציר "X מתוך Y" לכל סוג אירובי עם יעד שבועי — נדרש גם במסך הבית,
 * לא רק בכרטיס "אירובי השבוע" שבתוך מסך האימון.
 * @returns {Promise<{name:string, icon:string, count:number, goal:number}[]>}
 */
export async function weeklyCardioSummary() {
  const [templates, week] = await Promise.all([getCardioTemplates(), cardioThisWeek()]);
  return templates
    .filter((t) => num(t.weeklyGoal, 0) > 0)
    .map((t) => ({
      name: t.name,
      icon: t.icon || '🏃',
      count: week.filter((c) => c.templateId === t.id).length,
      goal: num(t.weeklyGoal, 0),
    }));
}

async function saveTemplate(t) {
  await db.put(db.STORES.routines, t);
  invalidateCardioCache();
}

async function deleteTemplate(id) {
  await db.del(db.STORES.routines, id);
  invalidateCardioCache();
  // מנקים שיבוצים שהצביעו על התבנית שנמחקה
  const schedule = await getCardioSchedule();
  let touched = false;
  for (let i = 0; i < 7; i++) {
    if (schedule[i] === id) { schedule[i] = null; touched = true; }
  }
  if (touched) await setCardioSchedule(schedule);
}

/* ---------- רישומים ---------- */

/** כל רישומי האירובי ליום נתון */
export async function cardioForDate(date) {
  const rows = await db.getAllByIndex(db.STORES.workouts, 'date', IDBKeyRange.only(date));
  // ממיינים לפי רגע הרישום ולא לפי startedAt, שמחושב אחורה לפי משך האימון
  return rows.filter((w) => w.kind === 'cardio').sort((a, b) => a.endedAt - b.endedAt);
}

async function logCardio(template, minutes) {
  const now = Date.now();
  const mins = Math.max(1, num(minutes, template.minutes || 30));
  await db.put(db.STORES.workouts, {
    id: db.uid(),
    kind: 'cardio',
    date: dateKey(),
    name: template.name,
    icon: template.icon || '🏃',
    templateId: template.id,
    durationSec: mins * 60,
    startedAt: now - mins * 60000,
    endedAt: now,
    exercises: [],       // כדי שקוד קיים שמצפה למערך לא ייפול
    totalVolume: 0,
    totalSets: 0,
    exerciseCount: 0,
  });
  onLogged?.();

  // רגע חגיגי בדיוק כשמגיעים ליעד השבועי — לא לפני ולא אחרי
  const goal = num(template.weeklyGoal, 0);
  if (goal > 0) {
    const weekCount = (await cardioThisWeek()).filter((c) => c.templateId === template.id).length;
    if (weekCount === goal) celebrateWeeklyGoal(template);
  }
}

function celebrateWeeklyGoal(template) {
  const layer = el('div', { class: 'goal-burst' },
    el('div', { class: 'goal-burst-confetti' }),
    el('div', { class: 'goal-burst-card' },
      el('div', { class: 'goal-burst-emoji' }, '🏆'),
      el('div', { class: 'goal-burst-title' }, 'כל הכבוד!'),
      el('div', { class: 'goal-burst-sub' },
        `השלמת את היעד השבועי ל${template.icon || '🏃'} ${template.name} — ${template.weeklyGoal} מתוך ${template.weeklyGoal}`),
    ),
  );
  document.body.append(layer);
  confetti(layer.querySelector('.goal-burst-confetti'), 90);
  requestAnimationFrame(() => layer.classList.add('is-in'));
  setTimeout(() => layer.classList.add('is-out'), 2200);
  setTimeout(() => layer.remove(), 2700);
}

/* ---------- תצוגה ---------- */

export async function renderCardio() {
  const [templates, today, week, scheduledToday] = await Promise.all([
    getCardioTemplates(), cardioForDate(dateKey()), cardioThisWeek(), cardioTemplateForDay(),
  ]);
  const host = $('#cardioList');

  if (!templates.length) {
    host.replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏃'),
      el('p', { html: 'הגדר את סוגי האירובי שלך פעם אחת,<br>ואז תסמן וי בלחיצה אחת.' }),
      el('button', {
        class: 'btn btn-secondary btn-sm', style: 'margin-top:12px',
        onclick: guard(openCardioEditor),
      }, 'הגדר אירובי')));
    return;
  }

  // כפתור אחד בלבד לכל סוג אירובי — לא כרטיס יעד נפרד + שורת רישום נפרדת.
  // בלי יעד שבועי: עיגול בודד (לחיצה = סימון היום, לחיצה נוספת = ביטול).
  // עם יעד שבועי: עיגול לכל מפגש (לחיצה על ריק = הוספה, על מלא = הסרה).
  // מספר המפגשים ליעד (goal) נקבע רק דרך ההגדרות, לא כאן.
  host.replaceChildren(...templates.map((t) => {
    const goal = num(t.weeklyGoal, 0);

    if (goal > 0) {
      const weekEntries = week.filter((c) => c.templateId === t.id).sort((a, b) => a.endedAt - b.endedAt);
      const count = weekEntries.length;
      const done = count >= goal;
      const dots = Array.from({ length: goal }, (_, i) => {
        const filled = i < count;
        return el('button', {
          class: `wg-dot${filled ? ' filled' : ''}`,
          'aria-label': filled ? `הסר מפגש ${t.name}` : `הוסף מפגש ${t.name}`,
          onclick: guard(async (e) => {
            e.stopPropagation();
            if (filled) {
              const last = weekEntries[weekEntries.length - 1];
              if (last) await db.del(db.STORES.workouts, last.id);
              await renderCardio();
              onLogged?.();
              toast(`${t.name} בוטל`, '');
            } else {
              await logCardio(t, t.minutes);
              await renderCardio();
              toast(`${t.name} נרשם ✓`, 'ok');
            }
          }),
        });
      });
      return el('div', { class: `cardio-row${done ? ' is-done' : ''}` },
        el('div', { class: 'cardio-icon' }, t.icon || '🏃'),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, t.name,
            scheduledToday?.id === t.id ? el('span', { class: 'li-tag' }, '📅 מתוכנן היום') : null),
          el('div', { class: 'li-sub' }, `${count}/${goal} השבוע · לחיצה על עיגול = הוספה/הסרה`),
        ),
        el('div', { class: 'wg-dots' }, ...dots),
      );
    }

    const entry = today.find((c) => c.templateId === t.id);
    const done = !!entry;
    return el('div', {
      class: `cardio-row${done ? ' is-done' : ''}`,
      onclick: guard(async () => {
        if (done) {
          await db.del(db.STORES.workouts, entry.id);
          await renderCardio();
          onLogged?.();
          toast(`${t.name} בוטל`, '');
        } else {
          await logCardio(t, t.minutes);
          await renderCardio();
          toast(`${t.name} נרשם ✓`, 'ok');
        }
      }),
      role: 'button',
    },
      el('div', { class: 'cardio-icon' }, t.icon || '🏃'),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, t.name,
          scheduledToday?.id === t.id ? el('span', { class: 'li-tag' }, '📅 מתוכנן היום') : null),
        el('div', { class: 'li-sub' }, `${t.minutes} דק' · לחיצה = סימון, לחיצה נוספת = ביטול`),
      ),
      done
        ? el('div', { class: 'cardio-count' }, '✓')
        : el('div', { class: 'cardio-plus' }, '+'),
    );
  }));
}

/* ---------- עורך סוגי אירובי ---------- */

export async function openCardioEditor() {
  const items = (await getCardioTemplates()).map((t) => ({ ...t }));

  const listHost = el('div', { class: 'plan-ex-list' });

  const renderList = () => {
    if (!items.length) {
      listHost.replaceChildren(el('div', { class: 'empty-state', style: 'padding:18px' },
        el('p', {}, 'בחר מהמוצעים למטה, או הוסף משלך')));
      return;
    }
    listHost.replaceChildren(...items.map((t, i) => el('div', { class: 'plan-ex' },
      el('div', { class: 'plan-ex-idx' }, t.icon || '🏃'),
      el('div', { class: 'plan-ex-main' },
        el('input', {
          type: 'text', value: t.name, placeholder: 'שם (למשל: ריצה)',
          oninput: (e) => { t.name = e.target.value; },
        }),
        el('div', { class: 'plan-ex-targets' },
          el('input', {
            type: 'number', inputmode: 'numeric', min: '1', max: '600', value: t.minutes,
            'aria-label': 'דקות',
            oninput: (e) => { t.minutes = Math.max(1, parseInt(e.target.value, 10) || 1); },
          }),
          el('span', {}, 'דקות כברירת מחדל'),
        ),
        el('div', { class: 'plan-ex-targets' },
          el('input', {
            type: 'number', inputmode: 'numeric', min: '0', max: '14', value: t.weeklyGoal || '',
            placeholder: '0', 'aria-label': 'יעד שבועי',
            oninput: (e) => { t.weeklyGoal = Math.max(0, parseInt(e.target.value, 10) || 0); },
          }),
          el('span', {}, 'פעמים בשבוע (0 = בלי יעד)'),
        ),
      ),
      el('div', { class: 'plan-ex-actions' },
        el('button', {
          class: 'icon-btn', 'aria-label': 'מחק', onclick: () => { items.splice(i, 1); renderList(); },
        }, '✕'),
      ),
    )));
  };
  renderList();

  const unused = SUGGESTED.filter((s) => !items.some((t) => t.name === s.name));

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'הגדר את סוגי האירובי שאתה עושה. אחר כך תסמן אותם בלחיצה אחת, כמה פעמים שבא לך ביום.'),
    listHost,

    unused.length ? el('div', {},
      el('p', { class: 'muted', style: 'margin:16px 0 8px;font-size:.82rem' }, 'הצעות:'),
      el('div', { class: 'chip-row' },
        ...unused.map((s) => el('button', {
          class: 'chip',
          onclick: (e) => {
            items.push(newTemplate(s.name, s.minutes, s.icon));
            e.target.remove();
            renderList();
          },
        }, `${s.icon} ${s.name}`)),
      ),
    ) : null,

    el('button', {
      class: 'add-set-btn', style: 'margin-top:10px',
      onclick: () => { items.push(newTemplate('', 30, '🏃')); renderList(); listHost.querySelector('.plan-ex:last-child input')?.focus(); },
    }, '+ סוג משלי'),

    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:16px',
      onclick: guard(async () => {
        const existing = await getCardioTemplates();
        for (const old of existing) {
          if (!items.some((t) => t.id === old.id)) await deleteTemplate(old.id);
        }
        let order = 0;
        for (const t of items) {
          if (!t.name.trim()) continue;
          await saveTemplate({ ...t, kind: 'cardio', name: t.name.trim(), order: order++ });
        }
        closeSheet();
        await renderCardio();
        toast('נשמר', 'ok');
      }),
    }, 'שמור'),
  );

  openSheet('סוגי אירובי', body);
}

/* ---------- אתחול ---------- */

export function initCardio({ onUpdate } = {}) {
  onLogged = onUpdate;
  // העריכה נפתחת ממסך ההגדרות בלבד (settings.js)
}
