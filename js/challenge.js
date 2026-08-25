/* ===================================================================
   challenge.js — אתגר אישי מוגדר-ימים (למשל "90 יום לאכול נכון ולהתאמן").
   נקבע פעם אחת בהגדרות (יעד + מספר ימים), ומסך הבית מציג כרטיס קטן
   שבו מסמנים כל יום האם עמדת בו. אתגר אחד פעיל בכל זמן נתון.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, guard, num, dateKey, parseDateKey, confetti,
  openSheet, closeSheet, confirmSheet,
} from './ui.js';

const CHALLENGE_KEY = 'activeChallenge';
const COMPLETED_KEY = 'challengesCompletedCount';

let loaded = false;
let cache = null;

/** נדרש אחרי ייבוא גיבוי או איפוס נתונים */
export function invalidateChallengeCache() { loaded = false; cache = null; }

async function load() {
  if (!loaded) {
    cache = await db.getSetting(CHALLENGE_KEY, null);
    loaded = true;
  }
  return cache;
}

async function save(challenge) {
  cache = challenge;
  loaded = true;
  if (challenge) await db.setSetting(CHALLENGE_KEY, challenge);
  else await db.delSetting(CHALLENGE_KEY);
}

export async function getChallenge() { return load(); }

export async function getCompletedCount() {
  return db.getSetting(COMPLETED_KEY, 0);
}

async function bumpCompletedCount() {
  const n = await db.getSetting(COMPLETED_KEY, 0);
  await db.setSetting(COMPLETED_KEY, n + 1);
}

export async function startChallenge(goalText, days) {
  await save({
    goalText: goalText.trim(),
    days: Math.max(1, Math.round(days) || 1),
    startDate: dateKey(),
    checks: {},
    completedCounted: false,
  });
}

export async function endChallenge() {
  await save(null);
}

/** מצב נגזר של האתגר — לא נשמר, מחושב מחדש מהתאריך הנוכחי בכל קריאה */
export function challengeStatus(challenge) {
  if (!challenge) return null;
  const today = dateKey();
  const dayIndex = Math.round((parseDateKey(today) - parseDateKey(challenge.startDate)) / 86400000) + 1;
  const marks = Object.values(challenge.checks);
  return {
    dayIndex: Math.min(Math.max(dayIndex, 1), challenge.days),
    keptCount: marks.filter((v) => v === true).length,
    brokenCount: marks.filter((v) => v === false).length,
    isFinished: dayIndex > challenge.days,
    todayMark: challenge.checks[today],
  };
}

/** אם עברו כל הימים ועדיין לא נספר — סופרים פעם אחת בלבד להישג "אתגר הושלם" */
async function ensureCompletionCounted(challenge) {
  if (!challenge || challenge.completedCounted) return { challenge, justCompleted: false };
  if (!challengeStatus(challenge).isFinished) return { challenge, justCompleted: false };
  const updated = { ...challenge, completedCounted: true };
  await save(updated);
  await bumpCompletedCount();
  return { challenge: updated, justCompleted: true };
}

export async function markToday(kept) {
  const challenge = await load();
  if (!challenge) return;
  await save({ ...challenge, checks: { ...challenge.checks, [dateKey()]: kept } });
}

/** מחמאה שמתאימה לביצוע בפועל, לא רק "סיימת" יבש */
function praiseMessage(status, challenge) {
  const rate = challenge.days > 0 ? status.keptCount / challenge.days : 0;
  if (rate >= 0.9) return `🏆 מעולה! עמדת ב-${status.keptCount} מתוך ${challenge.days} ימים — ביצוע יוצא מן הכלל.`;
  if (rate >= 0.6) return `🎉 כל הכבוד! עמדת ב-${status.keptCount} מתוך ${challenge.days} ימים — הישג אמיתי.`;
  return `💪 סיימת את האתגר! עמדת ב-${status.keptCount} מתוך ${challenge.days} ימים — כל התחלה קשה, ואתה כבר בפנים.`;
}

/* ---------- מסך הבית: כרטיס קטן, מוצג רק כשיש אתגר פעיל ---------- */

export async function renderChallengeWidget() {
  let challenge = await load();
  const section = $('#challengeSection');
  const host = $('#challengeCard');
  section.classList.remove('hidden');
  host.classList.remove('is-empty');

  if (!challenge) {
    $('#challengeTitle').textContent = 'אתגר';
    $('#challengeDay').textContent = '';
    host.classList.add('is-empty');
    host.replaceChildren(el('p', {}, 'אין אתגר פעיל. אפשר להתחיל אחד דרך ההגדרות.'));
    return;
  }

  const { challenge: updated, justCompleted } = await ensureCompletionCounted(challenge);
  challenge = updated;
  const status = challengeStatus(challenge);
  section.classList.remove('hidden');

  $('#challengeTitle').textContent = challenge.goalText;
  $('#challengeDay').textContent = status.isFinished ? 'הסתיים 🎉' : `יום ${status.dayIndex} מתוך ${challenge.days}`;

  const rows = [
    // replaceChildren, בניגוד ל-el(), לא מסנן null בעצמו — צריך לפרוס מערך ריק
    ...(justCompleted ? [el('div', { class: 'challenge-confetti' })] : []),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill', style: `width:${Math.min(status.dayIndex / challenge.days, 1) * 100}%` })),
  ];

  if (status.isFinished) {
    rows.push(el('p', { class: `challenge-msg${justCompleted ? ' is-praise' : ''}` }, praiseMessage(status, challenge)));
    rows.push(el('p', { class: 'challenge-msg' }, 'אפשר להתחיל אתגר חדש בהגדרות.'));
  } else if (status.todayMark === undefined) {
    rows.push(el('div', { class: 'challenge-actions' },
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: guard(async () => { await markToday(true); await renderChallengeWidget(); }),
      }, '✓ עמדתי היום'),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: guard(async () => { await markToday(false); await renderChallengeWidget(); }),
      }, '✗ לא הפעם'),
    ));
  } else {
    rows.push(el('p', { class: `challenge-msg${status.todayMark ? '' : ' is-gentle'}` },
      status.todayMark ? '✓ סימנת שעמדת היום — כל הכבוד' : 'לא נורא, סומך עליך — מחר יום חדש 🌙'));
  }

  host.replaceChildren(...rows);
  if (justCompleted) {
    const confettiHost = host.querySelector('.challenge-confetti');
    if (confettiHost) confetti(confettiHost, 40);
  }
}

/* ---------- הגדרות ---------- */

function openNewChallengeSheet() {
  const goalInput = el('textarea', { rows: 3, placeholder: 'לדוגמה: 90 יום להתאמן ולאכול נכון' });
  const daysInput = el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '365', value: '90' });

  const save1 = guard(async () => {
    const goalText = goalInput.value.trim();
    if (!goalText) { toast('כתוב מה האתגר שלך', 'err'); return; }
    await startChallenge(goalText, num(daysInput.value, 90));
    await renderChallengeWidget();
    closeSheet();
    toast('האתגר התחיל — בהצלחה! 💪', 'ok');
  });

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'מה האתגר שלך?'), goalInput),
    el('div', { class: 'field' }, el('label', {}, 'כמה ימים'), daysInput),
    el('button', { class: 'btn btn-primary btn-block', onclick: save1 }, 'התחל אתגר'),
  );
  openSheet('אתגר חדש', body);
  setTimeout(() => goalInput.focus(), 120);
}

export async function openChallengeSettings() {
  const challenge = await load();

  if (!challenge) { openNewChallengeSheet(); return; }

  const status = challengeStatus(challenge);

  if (status.isFinished) {
    const body = el('div', {},
      el('p', {}, `🎉 סיימת את "${challenge.goalText}"! עמדת ב-${status.keptCount} מתוך ${challenge.days} ימים.`),
      el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:14px',
        onclick: guard(() => { closeSheet(); openNewChallengeSheet(); }),
      }, 'התחל אתגר חדש'),
    );
    openSheet('האתגר שלי', body);
    return;
  }

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' }, challenge.goalText),
    el('div', { class: 'chart-legend' },
      el('div', { class: 'cl' }, el('b', {}, String(status.dayIndex)), el('span', {}, `מתוך ${challenge.days} ימים`)),
      el('div', { class: 'cl' }, el('b', {}, String(status.keptCount)), el('span', {}, 'ימים שעמדת')),
      el('div', { class: 'cl' }, el('b', {}, String(status.brokenCount)), el('span', {}, 'ימים שפספסת')),
    ),
    el('button', {
      class: 'btn btn-danger btn-block', style: 'margin-top:18px',
      onclick: guard(async () => {
        const ok = await confirmSheet('סיום אתגר', 'לסיים את האתגר הנוכחי? אפשר להתחיל אתגר חדש מיד אחר כך.', 'סיים אתגר');
        if (!ok) return;
        await endChallenge();
        await renderChallengeWidget();
        closeSheet();
        toast('האתגר הסתיים');
      }),
    }, 'סיים אתגר'),
  );
  openSheet('האתגר שלי', body);
}
