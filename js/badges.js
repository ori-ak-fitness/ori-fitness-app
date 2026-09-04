/* ===================================================================
   badges.js — מדליות/הישגים: מחושבים תמיד מחדש מהנתונים הקיימים
   (אימונים, שיאים, שקילות, אתגרים) — בלי אחסון נפרד משלהם, כך שאי
   אפשר שהם ייצאו מסונכרנים מהמצב האמיתי.
   =================================================================== */

import { el, openSheet, dateKey, parseDateKey } from './ui.js';
import { getAllWorkouts } from './workouts.js';
import { prSetsByWorkout } from './records.js';
import { getWeightEntries } from './bodyweight.js';
import { getWeeklyWorkoutGoal } from './dashboard.js';
import { getCompletedCount } from './challenge.js';

/** מפתח יום ראשון של השבוע הקלנדרי שמכיל את התאריך הנתון */
function weekKey(dateStr) {
  const d = parseDateKey(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return dateKey(d);
}

const BADGES = [
  { icon: '🏋️', name: 'אימון ראשון', check: (ctx) => ctx.workoutCount >= 1 },
  { icon: '🔥', name: '10 אימונים', check: (ctx) => ctx.workoutCount >= 10 },
  { icon: '💪', name: '50 אימונים', check: (ctx) => ctx.workoutCount >= 50 },
  { icon: '💯', name: '100 אימונים', check: (ctx) => ctx.workoutCount >= 100 },
  { icon: '🏆', name: 'שיא ראשון', check: (ctx) => ctx.prCount >= 1 },
  { icon: '🥇', name: '5 שיאים', check: (ctx) => ctx.prCount >= 5 },
  { icon: '🥋', name: '10 שיאים', check: (ctx) => ctx.prCount >= 10 },
  { icon: '🏋️', name: '10 שקילות', check: (ctx) => ctx.weighInCount >= 10 },
  { icon: '📈', name: '30 שקילות', check: (ctx) => ctx.weighInCount >= 30 },
  { icon: '📅', name: 'שבוע מושלם', check: (ctx) => ctx.hadPerfectWeek },
  { icon: '🎯', name: 'אתגר הושלם', check: (ctx) => ctx.completedChallenges >= 1 },
  { icon: '🔁', name: '3 אתגרים הושלמו', check: (ctx) => ctx.completedChallenges >= 3 },
];

async function buildContext() {
  const [workouts, weightEntries, weeklyGoal, completedChallenges] = await Promise.all([
    getAllWorkouts(), getWeightEntries(), getWeeklyWorkoutGoal(), getCompletedCount(),
  ]);

  let prCount = 0;
  for (const sets of prSetsByWorkout(workouts).values()) prCount += sets.size;

  const perWeek = new Map();
  for (const w of workouts) {
    const wk = weekKey(w.date);
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
  }
  const hadPerfectWeek = weeklyGoal > 0 && [...perWeek.values()].some((n) => n >= weeklyGoal);

  return { workoutCount: workouts.length, prCount, weighInCount: weightEntries.length, hadPerfectWeek, completedChallenges };
}

export async function getBadgeStatus() {
  const ctx = await buildContext();
  return BADGES.map((b) => ({ ...b, earned: !!b.check(ctx) }));
}

export async function openBadgesSheet() {
  const badges = await getBadgeStatus();
  const earnedCount = badges.filter((b) => b.earned).length;

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' }, `${earnedCount} מתוך ${badges.length} מדליות`),
    el('div', { class: 'badge-grid' }, ...badges.map((b) => el('div', { class: `badge-tile${b.earned ? ' is-earned' : ''}` },
      el('div', { class: 'badge-icon' }, b.earned ? b.icon : '🔒'),
      el('div', { class: 'badge-name' }, b.name),
    ))),
  );
  openSheet('🏅 מדליות', body);
}
