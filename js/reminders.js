/* ===================================================================
   reminders.js — תזכורות במסך הבית.

   ⚠️ מה זה כן ומה זה לא:
   זו **אינה** התראה שמגיעה לטלפון כשהאפליקציה סגורה. התראה כזו
   דורשת שרת ששולח אותה בזמן שנקבע, ובתוכנית החינמית של Firebase אין
   שרת כזה. מה שיש כאן הוא תזכורת שממתינה בראש מסך הבית ומופיעה
   בפעם הראשונה שנכנסים — היא לא נעלמת מעצמה כמו הודעה חולפת, ויש
   בה כפתור שעושה את הפעולה במקום.

   שתי תזכורות:
     1. שקילה שבועית — יום שלישי, אם לא נשקלת השבוע.
     2. אימון שלא סומן — יום שיש בו אימון מתוכנן, מהערב והלאה.
   =================================================================== */

import * as db from './db.js';
import { $, el, dateKey, shiftDateKey } from './ui.js';

const DISMISS_KEY = 'remindersDismissed';

/* מאיזו שעה שואלים על אימון שלא סומן. לפני זה עוד יש את כל היום
   לעשות אותו, ותזכורת בבוקר היא רק נדנוד. */
const WORKOUT_REMINDER_HOUR = 18;

let deps = {};

async function readDismissed() {
  const raw = await db.getSetting(DISMISS_KEY, null);
  return raw && typeof raw === 'object' ? raw : {};
}

/** נדחה להיום בלבד — מחר אותה תזכורת רלוונטית שוב */
async function dismiss(id) {
  const all = await readDismissed();
  all[id] = dateKey();
  await db.setSetting(DISMISS_KEY, all);
}

/* ---------- מה להציג ---------- */

async function weighInReminder(dismissed) {
  const today = dateKey();
  if (new Date().getDay() !== 2) return null;          // 2 = יום שלישי
  if (dismissed.weighIn === today) return null;

  const entries = await deps.getWeightEntries();
  const sunday = shiftDateKey(today, -new Date().getDay());
  if (entries.some((e) => e.date >= sunday && e.date <= today)) return null;

  return {
    id: 'weighIn',
    icon: '⚖️',
    title: 'שקילה שבועית',
    text: 'יום שלישי — עוד לא נשקלת השבוע.',
    action: 'שקול עכשיו',
    onAction: () => deps.goToWeighIn?.(),
  };
}

async function workoutReminder(dismissed) {
  const today = dateKey();
  if (dismissed.workout === today) return null;
  if (new Date().getHours() < WORKOUT_REMINDER_HOUR) return null;

  const [routines, schedule] = await Promise.all([deps.getRoutines(), deps.getSchedule()]);
  const routineId = schedule[new Date().getDay()];
  if (!routineId) return null;                          // יום מנוחה

  const routine = routines.find((r) => r.id === routineId);
  if (!routine) return null;
  if (await deps.isDoneToday(routine.id)) return null;

  return {
    id: 'workout',
    icon: '🏋️',
    title: 'האימון של היום',
    text: `${routine.name} עוד לא סומן היום.`,
    action: 'התחל',
    onAction: () => deps.startWorkout?.(routine),
  };
}

/* נפרדת מתזכורת האימון בכוונה — יום יכול להכיל גם כוח וגם אירובי,
   ואם שניהם לא סומנו רוצים שתי תזכורות, לא אחת שמסתירה את השנייה */
async function cardioReminder(dismissed) {
  const today = dateKey();
  if (dismissed.cardio === today) return null;
  if (new Date().getHours() < WORKOUT_REMINDER_HOUR) return null;

  const template = await deps.cardioTemplateForDay?.(new Date().getDay());
  if (!template) return null;                           // אין אירובי מתוכנן היום

  const logs = await deps.cardioForDate?.(today) ?? [];
  if (logs.some((w) => w.templateId === template.id)) return null;

  return {
    id: 'cardio',
    icon: template.icon || '🏃',
    title: 'האירובי של היום',
    text: `${template.name} עוד לא סומן היום.`,
    action: 'סמן',
    onAction: () => deps.goToCardio?.(),
  };
}

/* ---------- תצוגה ---------- */

export async function renderReminders() {
  const host = $('#remindersHost');
  if (!host) return;

  const dismissed = await readDismissed();
  const items = (await Promise.all([
    weighInReminder(dismissed),
    workoutReminder(dismissed),
    cardioReminder(dismissed),
  ])).filter(Boolean);

  if (!items.length) { host.replaceChildren(); return; }

  host.replaceChildren(...items.map((item) => el('div', { class: 'reminder' },
    el('span', { class: 'reminder-ico' }, item.icon),
    el('div', { class: 'reminder-main' },
      el('div', { class: 'reminder-title' }, item.title),
      el('div', { class: 'reminder-text' }, item.text),
    ),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => { await dismiss(item.id); await renderReminders(); item.onAction(); },
    }, item.action),
    el('button', {
      class: 'reminder-x', 'aria-label': 'הסתר',
      onclick: async () => { await dismiss(item.id); await renderReminders(); },
    }, '✕'),
  )));
}

/**
 * @param {{getWeightEntries:Function, getRoutines:Function, getSchedule:Function,
 *          isDoneToday:Function, startWorkout:Function, goToWeighIn:Function,
 *          cardioTemplateForDay:Function, cardioForDate:Function, goToCardio:Function}} api
 */
export function initReminders(api) {
  deps = api;
}
