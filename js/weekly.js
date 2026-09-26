/* ===================================================================
   weekly.js — הסיכום השבועי: "מה היה השבוע", פעם בשבוע, במוצאי שבת.

   לא מסך נוסף כמו "התקדמות" — כרטיס קטן שמופיע בראש הבית מהמוצ"ש
   (20:00) ועד סוף יום שלישי, ולחיצה עליו פותחת גיליון עם הסיכום.
   במקביל, הסקריפט שבענן (scripts/send-reminders.mjs) שולח באותה שעה
   התראה לטלפון, ולחיצה עליה פותחת את אותו גיליון.

   הטון מעודד תמיד, כמו שאורי ביקש: "3 מתוך 4 — שבוע טוב", אף פעם לא
   "פספסת". גם ההשוואה לשבוע שעבר מוצגת רק כשהיא לטובה.

   הכל מחושב מחדש מהנתונים בכל פתיחה ולא נשמר — מחיקה או עריכה של
   אימון מתעדכנת מיד. הדבר היחיד שנשמר הוא איזה שבוע כבר נצפה.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, dateKey, shiftDateKey, parseDateKey,
  fmtNum, formatDurationHe, heCount, num,
} from './ui.js';
import { getAllWorkouts } from './workouts.js';
import { prSetsByWorkout, isSetDone } from './records.js';
import { totalsForDate, goalForDate } from './nutrition.js';
import { getWeightEntries } from './bodyweight.js';
import { getWeeklyWorkoutGoal } from './dashboard.js';
import { getRoutines, getSchedule } from './routines.js';
import { getCardioSchedule } from './cardio.js';

const SEEN_KEY = 'weeklyRecapSeen';
// מוצאי שבת: שבת נגמרת בין 17:30 בחורף לקצת אחרי 20:00 בסוף יוני —
// 20:00 בטוח כל השנה. אותה שעה בדיוק כמו ההתראה שבענן.
const RECAP_HOUR = 20;
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/* ---------- איזה שבוע ---------- */

/**
 * יום ראשון של השבוע שהסיכום שלו זמין עכשיו, או null מחוץ לחלון.
 * שבת מ-20:00 → השבוע שנגמר עכשיו. ראשון–שלישי → השבוע הקודם.
 */
function recapWeekStart(now = new Date()) {
  const day = now.getDay();
  const today = dateKey(now);
  if (day === 6 && now.getHours() >= RECAP_HOUR) return shiftDateKey(today, -6);
  if (day <= 2) return shiftDateKey(today, -day - 7);
  return null;
}

function rangeLabel(sunday) {
  const a = parseDateKey(sunday);
  const b = parseDateKey(shiftDateKey(sunday, 6));
  return a.getMonth() === b.getMonth()
    ? `${ltr(`${a.getDate()}–${b.getDate()}`)} ב${HE_MONTHS[b.getMonth()]}`
    : `${a.getDate()} ב${HE_MONTHS[a.getMonth()]} – ${b.getDate()} ב${HE_MONTHS[b.getMonth()]}`;
}

const inWeek = (sunday) => {
  const saturday = shiftDateKey(sunday, 6);
  return (w) => w.date >= sunday && w.date <= saturday;
};

const isCardio = (w) => w.kind === 'cardio';

/* מספרים עם סימנים (20–26, ≈1,690, −0.6, 80×6) בתוך טקסט עברי: אלגוריתם
   הכיווניות הופך את הסדר שלהם. בידוד LTR שומר אותם בדיוק כמו שנכתבו */
const ltr = (s) => `⁦${s}⁩`;

/* ---------- קלוריות שנשרפו (הערכה) ---------- */

/*
 * MET × משקל גוף × שעות — הנוסחה המקובלת. זו הערכה גסה ולכן היא מוצגת
 * עם "≈". כוח: MET 5 (אימון משקולות רגיל). אירובי: לפי השם/האייקון.
 * אימון שנשכח פתוח שעות לא מנפח את המספר — תקרה של שעתיים וחצי.
 */
function cardioMet(w) {
  const s = `${w.name || ''} ${w.icon || ''}`;
  if (/ריצ|🏃/.test(s)) return 9;
  if (/אופני|🚴|ספינינג/.test(s)) return 7.5;
  if (/שחי|🏊/.test(s)) return 7;
  if (/חבל|קפיצ|HIIT|אינטרוול/i.test(s)) return 10;
  if (/הליכ|🚶/.test(s)) return 4;
  return 6;
}

function burnedKcal(workouts, weightKg) {
  let kcal = 0;
  for (const w of workouts) {
    const hours = Math.min(num(w.durationSec, 0), 9000) / 3600;
    kcal += (isCardio(w) ? cardioMet(w) : 5) * weightKg * hours;
  }
  return Math.round(kcal / 10) * 10;
}

/* ---------- החישוב ---------- */

async function buildRecap(sunday) {
  const [all, goal, weights] = await Promise.all([
    getAllWorkouts(), getWeeklyWorkoutGoal(), getWeightEntries(),
  ]);
  const week = all.filter(inWeek(sunday));
  const prevWeek = all.filter(inWeek(shiftDateKey(sunday, -7)));
  const strength = week.filter((w) => !isCardio(w));
  const cardio = week.filter(isCardio);
  const saturday = shiftDateKey(sunday, 6);

  // שיאים: אותו חישוב בדיוק כמו התגיות 🏆 ביומן, רק מסונן לשבוע הזה.
  // לכל תרגיל נשמר הסט הכבד ביותר ששבר שיא, כדי שתרגיל לא יופיע פעמיים
  const prMap = prSetsByWorkout(all);
  const prByExercise = new Map();
  for (const w of strength) {
    const ids = prMap.get(w.id);
    if (!ids) continue;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!ids.has(s.id)) continue;
        const cur = prByExercise.get(ex.name);
        if (!cur || num(s.weight) > num(cur.weight)) prByExercise.set(ex.name, { name: ex.name, weight: s.weight, reps: s.reps });
      }
    }
  }

  // התרגיל של השבוע — זה שעשית בו הכי הרבה סטים
  const setsByExercise = new Map();
  for (const w of strength) {
    for (const ex of w.exercises) {
      setsByExercise.set(ex.name, (setsByExercise.get(ex.name) ?? 0) + ex.sets.filter(isSetDone).length);
    }
  }
  const [topName, topSets] = [...setsByExercise].sort((a, b) => b[1] - a[1])[0] ?? [];

  // רצף שבועות שעמדת בהם ביעד, כולל השבוע הזה (עד שנה אחורה)
  let streak = 0;
  for (let i = 0; i < 52; i++) {
    const start = shiftDateKey(sunday, -7 * i);
    if (all.filter(inWeek(start)).length >= goal) streak++;
    else break;
  }

  // משקל: השקילה האחרונה בשבוע מול האחרונה שלפניו
  const weekWeights = weights.filter((e) => e.date >= sunday && e.date <= saturday);
  const lastInWeek = weekWeights.at(-1) ?? null;
  const before = weights.filter((e) => e.date < sunday).at(-1) ?? null;
  const latestWeight = weights.filter((e) => e.date <= saturday).at(-1)?.weight ?? 75;

  // תזונה: באיזה ימים רשמת משהו, וכמה מהם יצאו קרוב ליעד (±10%)
  const days = Array.from({ length: 7 }, (_, i) => shiftDateKey(sunday, i));
  const nutrition = await Promise.all(days.map(async (d) => {
    const [t, g] = await Promise.all([totalsForDate(d), goalForDate(d)]);
    return { calories: t.calories, protein: t.protein, goal: g };
  }));
  const logged = nutrition.filter((n) => n.calories > 0);
  const onTarget = logged.filter((n) => n.goal.calories > 0
    && Math.abs(n.calories - n.goal.calories) <= n.goal.calories * 0.1).length;

  return {
    sunday,
    goal,
    total: week.length,
    strengthCount: strength.length,
    cardioCount: cardio.length,
    prevTotal: prevWeek.length,
    activeDays: new Set(week.map((w) => w.date)).size,
    seconds: week.reduce((s, w) => s + num(w.durationSec, 0), 0),
    sets: strength.reduce((s, w) => s + num(w.totalSets, 0), 0),
    volume: strength.reduce((s, w) => s + num(w.totalVolume, 0), 0),
    kcal: burnedKcal(week, latestWeight),
    prs: [...prByExercise.values()],
    topExercise: topName && topSets >= 3 ? { name: topName, sets: topSets } : null,
    streak,
    weight: lastInWeek ? { now: lastInWeek.weight, delta: before ? lastInWeek.weight - before.weight : null } : null,
    loggedDays: logged.length,
    onTarget,
    avgKcal: logged.length ? logged.reduce((s, n) => s + n.calories, 0) / logged.length : 0,
    hasAnything: week.length > 0 || logged.length > 0 || weekWeights.length > 0,
  };
}

/* ---------- ניסוחים ---------- */

// מעודד תמיד — גם 0 הוא "שבוע מנוחה", לא כישלון
function tierLine(r) {
  if (r.total === 0) return 'שבוע של מנוחה. גם זה חלק מהדרך';
  if (r.total > r.goal) return 'מעל היעד — שבוע חזק במיוחד 🔥';
  if (r.total === r.goal) return 'עמדת ביעד — שבוע מצוין 🎯';
  if (r.total === r.goal - 1) return `${r.total} מתוך ${r.goal} — שבוע טוב`;
  return `${r.total} מתוך ${r.goal} — כל אימון נחשב`;
}

function fmtVolume(kg) {
  return kg >= 1000 ? `${fmtNum(kg / 1000, 1)} טון` : `${fmtNum(kg)} ק"ג`;
}

function fmtKg(n) {
  return `${fmtNum(num(n), 1)} ק"ג`;
}

/** מה מתוכנן לשבוע הבא — הצצה קדימה, כדי שהסיכום ייגמר בכיוון ולא בנקודה */
async function nextWeekLine(isSaturdayNight) {
  const [routines, schedule, cardioSchedule] = await Promise.all([getRoutines(), getSchedule(), getCardioSchedule()]);
  const planned = schedule.filter(Boolean).length + cardioSchedule.filter(Boolean).length;
  if (!planned) return null;
  const firstDay = schedule.findIndex(Boolean);
  const first = firstDay >= 0 ? routines.find((r) => r.id === schedule[firstDay]) : null;
  const when = isSaturdayNight ? 'בשבוע הבא' : 'השבוע';
  return {
    icon: '📅',
    text: `${when}: ${heCount(planned, 'אימון', 'אימונים')} בתוכנית`,
    sub: first ? `פותחים ביום ${HE_DAYS[firstDay]} עם ${first.name}` : null,
  };
}

async function moments(r) {
  const list = [];

  if (r.prs.length) {
    list.push({
      icon: '🏆',
      text: r.prs.length === 1 ? 'שברת שיא אישי' : `שברת ${r.prs.length} שיאים אישיים`,
      sub: r.prs.slice(0, 3).map((p) => `${p.name} ${ltr(`${fmtNum(num(p.weight), 1)}×${fmtNum(num(p.reps))}`)}`).join(' · '),
    });
  }
  if (r.streak >= 2) {
    list.push({ icon: '🔥', text: `שבוע ${r.streak} ברצף שעמדת ביעד`, sub: null });
  }
  if (r.total > r.prevTotal && r.prevTotal > 0) {
    list.push({ icon: '📈', text: `${heCount(r.total - r.prevTotal, 'אימון', 'אימונים')} יותר משבוע שעבר`, sub: null });
  }
  if (r.topExercise) {
    list.push({ icon: '💪', text: `התרגיל של השבוע: ${r.topExercise.name}`, sub: `${r.topExercise.sets} סטים` });
  }
  if (r.weight) {
    const d = r.weight.delta;
    list.push({
      icon: '⚖️',
      text: `נשקלת: ${fmtKg(r.weight.now)}`,
      sub: d === null ? null
        : Math.abs(d) < 0.05 ? 'בדיוק כמו בשקילה הקודמת'
        : `${ltr(`${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d), 1)}`)} מהשקילה הקודמת`,
    });
  }
  if (r.loggedDays) {
    list.push({
      icon: '🍎',
      text: `תיעדת תזונה ב-${r.loggedDays} מתוך 7 ימים`,
      sub: `ממוצע ${fmtNum(Math.round(r.avgKcal))} קק"ל ליום` + (r.onTarget ? ` · ${heCount(r.onTarget, 'יום', 'ימים')} בול ביעד` : ''),
    });
  }
  const next = await nextWeekLine(new Date().getDay() === 6);
  if (next) list.push(next);
  return list;
}

/* ---------- שיתוף ---------- */

async function shareRecap(r) {
  const lines = [
    `הסיכום השבועי שלי 💪 (${rangeLabel(r.sunday)})`,
    `${heCount(r.total, 'אימון', 'אימונים')}` + (r.seconds ? ` · ${formatDurationHe(r.seconds)}` : ''),
    r.prs.length ? `🏆 ${r.prs.length === 1 ? 'שיא אישי חדש' : `${r.prs.length} שיאים אישיים`}` : null,
    r.streak >= 2 ? `🔥 שבוע ${r.streak} ברצף ביעד` : null,
    '',
    `Ori AK Fitness — ${location.origin}${location.pathname.replace(/index\.html$/, '')}`,
  ].filter((l) => l !== null);
  const text = lines.join('\n');
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('הסיכום הועתק — אפשר להדביק בוואטסאפ', 'ok');
  } catch (err) {
    if (err?.name !== 'AbortError') toast('השיתוף לא הצליח', 'err');
  }
}

/* ---------- הגיליון ---------- */

export async function openWeeklyRecap(sunday = recapWeekStart() ?? shiftDateKey(dateKey(), -new Date().getDay() - 7)) {
  const r = await buildRecap(sunday);
  await db.setSetting(SEEN_KEY, sunday);
  renderWeeklyRecapCard();

  const split = [
    r.strengthCount ? `${r.strengthCount} כוח` : null,
    r.cardioCount ? `${r.cardioCount} אירובי` : null,
  ].filter(Boolean).join(' · ');

  const stat = (value, label) => el('div', { class: 'wr-stat' }, el('b', {}, value), el('span', {}, label));

  const items = await moments(r);

  const body = el('div', { class: 'wr' },
    el('div', { class: 'wr-hero' },
      el('div', { class: 'wr-range' }, rangeLabel(sunday)),
      el('div', { class: 'wr-big' }, String(r.total)),
      el('div', { class: 'wr-big-label' }, r.total === 1 ? 'אימון השבוע' : 'אימונים השבוע'),
      split ? el('div', { class: 'wr-split' }, split) : null,
      el('div', { class: 'wr-tier' }, tierLine(r)),
    ),
    r.total ? el('div', { class: 'wr-grid' },
      stat(formatDurationHe(r.seconds), 'זמן אימון'),
      stat(`${r.activeDays}/7`, 'ימים פעילים'),
      r.volume ? stat(fmtVolume(r.volume), 'הרמת בסה"כ') : stat(fmtNum(r.sets), 'סטים'),
      stat(ltr(`≈${fmtNum(r.kcal)}`), 'קק"ל נשרפו'),
    ) : null,
    items.length ? el('div', { class: 'wr-moments' },
      ...items.map((m) => el('div', { class: 'wr-moment' },
        el('span', { class: 'wr-moment-ico', 'aria-hidden': 'true' }, m.icon),
        el('div', { class: 'wr-moment-main' },
          el('div', { class: 'wr-moment-text' }, m.text),
          m.sub ? el('div', { class: 'wr-moment-sub' }, m.sub) : null,
        ),
      ))) : null,
    r.total ? el('button', { class: 'btn btn-primary btn-block', onclick: () => shareRecap(r) }, 'שתף את השבוע') : null,
    r.total ? el('p', { class: 'wr-note' }, 'הקלוריות הן הערכה לפי משקל הגוף ומשך האימון.') : null,
  );

  openSheet('הסיכום השבועי', body);
}

/* ---------- הכרטיס בבית ---------- */

export async function renderWeeklyRecapCard() {
  const host = $('#weeklyRecapHost');
  if (!host) return;
  const sunday = recapWeekStart();
  if (!sunday || (await db.getSetting(SEEN_KEY, null)) === sunday) { host.replaceChildren(); return; }

  const r = await buildRecap(sunday);
  if (!r.hasAnything) { host.replaceChildren(); return; }

  const title = r.total ? `${heCount(r.total, 'אימון', 'אימונים')} השבוע` : 'השבוע שלך';
  const hint = r.prs.length ? `🏆 ${r.prs.length === 1 ? 'שיא אישי' : `${r.prs.length} שיאים`} · ${tierLine(r)}` : tierLine(r);

  host.replaceChildren(el('div', { class: 'wr-card' },
    el('button', { class: 'wr-card-main', onclick: () => openWeeklyRecap(sunday) },
      el('span', { class: 'wr-card-kicker' }, `הסיכום השבועי · ${rangeLabel(sunday)}`),
      el('span', { class: 'wr-card-title' }, title),
      el('span', { class: 'wr-card-hint' }, hint),
      el('span', { class: 'wr-card-cta' }, 'לסיכום ‹'),
    ),
    el('button', {
      class: 'reminder-x wr-card-x', 'aria-label': 'הסתר',
      onclick: async () => { await db.setSetting(SEEN_KEY, sunday); host.replaceChildren(); },
    }, '✕'),
  ));
}

/**
 * לחיצה על ההתראה: כשהאפליקציה כבר פתוחה, ה-Service Worker שולח הודעה
 * (החלון רק מקבל פוקוס ולא נטען מחדש). כשהיא סגורה — היא נפתחת עם #recap.
 */
export function initWeeklyRecap({ openedFromLink = false } = {}) {
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open-recap') openWeeklyRecap();
  });
  if (openedFromLink) openWeeklyRecap();
}
