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
import { pushStatus, subscribeToPush } from './push.js';
import { openSheet, closeSheet } from './ui.js';

/* הצעת ההתראות חוזרת בכל פתיחה של האפליקציה עד שמפעילים (כך ביקש אורי —
   לא חד-פעמית כמו אישור מצלמה). "✕" מסתיר רק עד הפתיחה הבאה: sessionStorage
   נמחק כשסוגרים את האפליקציה, ואינו מסתנכרן בין מכשירים */
const PUSH_PROMPT_KEY = 'pushPromptHiddenThisSession';
const pushPromptDismissed = () => { try { return !!sessionStorage.getItem(PUSH_PROMPT_KEY); } catch { return false; } };
const dismissPushPrompt = () => { try { sessionStorage.setItem(PUSH_PROMPT_KEY, '1'); } catch { /* לא קריטי */ } };


const DISMISS_KEY = 'remindersDismissed';

/* מאיזו שעה שואלים על אימון שלא סומן — ברירת מחדל, נדרסת ע"י ההגדרה
   הניתנת לעריכה 'workoutReminderHour' (ראו settings.js). לפני השעה הזו
   עוד יש את כל היום לעשות אותו, ותזכורת בבוקר היא רק נדנוד. */
const DEFAULT_WORKOUT_REMINDER_HOUR = 18;

let deps = {};

/* אותה שעה גם לתזכורת האימון וגם לאירובי — זו אותה הגדרה בהגדרות
   ('שעת תזכורת אימון'), לא שתיים נפרדות */
async function workoutReminderHour() {
  const n = Number(await db.getSetting('workoutReminderHour', DEFAULT_WORKOUT_REMINDER_HOUR));
  return Number.isFinite(n) ? n : DEFAULT_WORKOUT_REMINDER_HOUR;
}

const DEFAULT_WEIGH_IN_REMINDER_HOUR = 5;
async function weighInReminderHour() {
  const n = Number(await db.getSetting('weighInReminderHour', DEFAULT_WEIGH_IN_REMINDER_HOUR));
  return Number.isFinite(n) ? n : DEFAULT_WEIGH_IN_REMINDER_HOUR;
}

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
  // כמו התראת ה-push: לא לפני השעה שנבחרה, גם אם פותחים את האפליקציה מוקדם יותר
  if (new Date().getHours() < await weighInReminderHour()) return null;

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
  if (new Date().getHours() < await workoutReminderHour()) return null;

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
  if (new Date().getHours() < await workoutReminderHour()) return null;

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

/*
 * הצעה להפעיל התראות לטלפון — כרטיס בראש הבית, ולחיצה על "הפעל" פותחת
 * את חלון האישור של המערכת (כמו אישור מצלמה). בלי זה ההפעלה קבורה
 * בהגדרות ואף אחד לא מוצא אותה. מוצג רק למי שהדפדפן שלו תומך, שעוד לא
 * הפעיל, ושלא חסם ולא ביקש "לא עכשיו". באייפון זה דורש אפליקציה
 * שהותקנה למסך הבית — בלשונית רגילה של ספארי אין תמיכה, והכרטיס פשוט לא מופיע.
 */
async function pushPrompt() {
  if (pushPromptDismissed()) return null;
  const base = { id: 'pushPrompt', icon: '🔔', title: 'התראות לטלפון', onDismiss: dismissPushPrompt };

  const status = await pushStatus();
  // אייפון: התראות עובדות רק מאפליקציה שהוספה למסך הבית, לא מלשונית ספארי
  if (status === 'ios-install') {
    return { ...base, text: 'כדי לקבל תזכורות באייפון: בספארי לחץ שתף ← "הוסף למסך הבית", ופתח את האפליקציה משם.' };
  }
  // חסום: אי אפשר לבקש שוב מתוך האפליקציה, רק להסביר איפה מתירים
  if (status === 'denied') {
    return { ...base, text: 'ההתראות חסומות. להפעלה: הגדרות הטלפון ← התראות ← האפליקציה ← אפשר התראות.' };
  }
  if (status !== 'available') return null;   // כבר מופעל / דפדפן שלא תומך בכלל

  return {
    ...base,
    text: 'תזכורת לאימון ולשקילה גם כשהאפליקציה סגורה.',
    action: 'הפעל',
    // הלחיצה עצמה חייבת להפעיל את בקשת ההרשאה (דרישה של הדפדפנים)
    onAction: async () => { if (await subscribeToPush()) await renderReminders(); },
  };
}

/**
 * גיליון "בפעם הראשונה שנכנסים": מוצג פעם אחת אחרי שהעדכון הזה מגיע
 * למשתמש קיים, ורק אם אפשר להפעיל התראות עכשיו (לא חסום, לא מופעל,
 * לא אייפון בלי התקנה - שם הכרטיס בבית מסביר). אחרי זה הכרטיס בבית
 * ממשיך להזכיר בכל פתיחה. לא נפתח מעל האשף - שם יש שלב משלו.
 */
export async function maybeShowPushIntro() {
  const FLAG = 'pushIntroSeen';
  try { if (localStorage.getItem(FLAG)) return; } catch { return; }
  if (!$('#wizard')?.classList.contains('hidden')) return;
  if ((await pushStatus()) !== 'available') return;
  try { localStorage.setItem(FLAG, '1'); } catch { /* לא קריטי */ }

  const body = el('div', {},
    el('p', { style: 'margin-bottom:16px;line-height:1.6' },
      'קבל תזכורת לשקילה, לאימון ולאירובי — גם כשהאפליקציה סגורה, כמו הודעה רגילה. ' +
      'את השעות אפשר לשנות בהגדרות.'),
    el('button', {
      class: 'btn btn-primary btn-block',
      // בקשת ההרשאה יוצאת ישירות מהלחיצה, בלי await לפניה
      onclick: () => { subscribeToPush().then((ok) => { if (ok) { closeSheet(); renderReminders(); } }); },
    }, 'הפעל התראות'),
    el('button', {
      class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
      onclick: () => closeSheet(),
    }, 'לא עכשיו'),
  );
  openSheet('🔔 תזכורות לטלפון', body);
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
    pushPrompt(),                 // אחרון: תזכורות אמיתיות קודם, ההצעה מתחתן
  ])).filter(Boolean);

  if (!items.length) { host.replaceChildren(); return; }

  host.replaceChildren(...items.map((item) => el('div', { class: 'reminder' },
    el('span', { class: 'reminder-ico' }, item.icon),
    el('div', { class: 'reminder-main' },
      el('div', { class: 'reminder-title' }, item.title),
      el('div', { class: 'reminder-text' }, item.text),
    ),
    item.action ? el('button', {
      class: 'btn btn-primary btn-sm',
      // פריט עם onDismiss (ההצעה להפעיל התראות): הפעולה רצה מיד, בלי שום
      // await לפניה — בקשת הרשאה חייבת לצאת מתוך הלחיצה עצמה, ואחרי
      // await לקריאת מסד נתונים הדפדפן כבר לא רואה בה מחווה של משתמש
      onclick: item.onDismiss
        ? () => { item.onAction(); }
        : async () => { await dismiss(item.id); await renderReminders(); item.onAction(); },
    }, item.action) : null,
    el('button', {
      class: 'reminder-x', 'aria-label': 'הסתר',
      onclick: async () => {
        if (item.onDismiss) item.onDismiss(); else await dismiss(item.id);
        await renderReminders();
      },
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
