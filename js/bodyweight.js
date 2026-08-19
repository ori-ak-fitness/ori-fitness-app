/* ===================================================================
   bodyweight.js — יומן שקילות: רשומה אחת ליום, גרף התקדמות,
   והיסטוריה לעריכה/מחיקה.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, confirmSheet, guard,
  dateKey, formatDateHe, shortDate, num, fmtNum,
} from './ui.js';
import { lineChart } from './charts.js';

let entriesCache = null;

/** נדרש אחרי ייבוא גיבוי או איפוס נתונים */
export function invalidateWeightCache() { entriesCache = null; }

async function loadEntries() {
  if (!entriesCache) {
    const all = await db.getAll(db.STORES.bodyWeight);
    entriesCache = all.sort((a, b) => a.date.localeCompare(b.date));
  }
  return entriesCache;
}

/** שקילה נוספת באותו יום דורסת את הקודמת — יום אחד, מספר אחד */
async function logWeight(weight, date = dateKey()) {
  const kg = num(weight, 0);
  if (kg <= 0) { toast('הזן משקל תקין', 'err'); return false; }
  await db.put(db.STORES.bodyWeight, { date, weight: kg, loggedAt: Date.now() });
  invalidateWeightCache();
  return true;
}

async function deleteWeight(date) {
  await db.del(db.STORES.bodyWeight, date);
  invalidateWeightCache();
}

/** לתצוגה במקומות נוספים (למשל מדליות), לא רק במסך ההתקדמות */
export async function getWeightEntries() {
  return loadEntries();
}

/* ---------- פרטי גוף (ל-BMI ולמחשבון קלוריות) ---------- */

const HEIGHT_KEY = 'userHeightCm';
const AGE_KEY = 'userAge';
const SEX_KEY = 'userSex';
const ACTIVITY_KEY = 'userActivityLevel';

export async function getUserHeightCm() {
  return db.getSetting(HEIGHT_KEY, null);
}

export async function setUserHeightCm(cm) {
  await db.setSetting(HEIGHT_KEY, cm > 0 ? cm : null);
}

export async function getUserAge() {
  return db.getSetting(AGE_KEY, null);
}

export async function setUserAge(age) {
  await db.setSetting(AGE_KEY, age > 0 ? age : null);
}

/** 'male' | 'female' | null */
export async function getUserSex() {
  return db.getSetting(SEX_KEY, null);
}

export async function setUserSex(sex) {
  await db.setSetting(SEX_KEY, sex || null);
}

export async function getActivityLevel() {
  return db.getSetting(ACTIVITY_KEY, 'moderate');
}

export async function setActivityLevel(level) {
  await db.setSetting(ACTIVITY_KEY, level);
}

/** BMI = משקל(ק"ג) / גובה(מ')² — null אם חסר גובה או משקל */
export function calcBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function bmiCategory(bmi) {
  if (bmi < 18.5) return 'תת-משקל';
  if (bmi < 25) return 'תקין';
  if (bmi < 30) return 'עודף משקל';
  return 'השמנה';
}

/* ---------- תצוגה ---------- */

export async function renderBodyWeight() {
  const entries = await loadEntries();
  const today = dateKey();
  const todayEntry = entries.find((e) => e.date === today);

  const badge = $('#lastWeightBadge');
  if (badge) badge.textContent = entries.length ? `🏋️ ${fmtNum(entries[entries.length - 1].weight, 1)} ק"ג` : '';

  const input = $('#weightInput');
  // לא דורסים משהו שהמשתמש כבר מקליד עכשיו
  if (document.activeElement !== input) input.value = todayEntry ? String(todayEntry.weight) : '';

  const points = entries.slice(-60).map((e) => ({ label: shortDate(e.date), value: e.weight }));
  lineChart($('#weightChart'), points, {
    unit: 'ק"ג',
    emptyText: 'רשום שקילה כדי לראות גרף התקדמות',
  });

  const stats = $('#weightStats');
  if (entries.length >= 1) {
    const last = entries[entries.length - 1].weight;
    const heightCm = await getUserHeightCm();
    const bmi = calcBMI(last, heightCm);
    const deltaTiles = entries.length >= 2
      ? (() => {
          const first = entries[0].weight;
          const delta = last - first;
          return [
            el('div', { class: 'cl' }, el('b', {}, fmtNum(last, 1)), el('span', {}, 'שקילה אחרונה (ק"ג)')),
            el('div', { class: 'cl' }, el('b', {}, `${delta >= 0 ? '+' : ''}${fmtNum(delta, 1)}`), el('span', {}, 'שינוי מהשקילה הראשונה')),
            el('div', { class: 'cl' }, el('b', {}, String(entries.length)), el('span', {}, 'שקילות')),
          ];
        })()
      : [el('div', { class: 'cl' }, el('b', {}, fmtNum(last, 1)), el('span', {}, 'שקילה אחרונה (ק"ג)'))];
    stats.replaceChildren(
      ...deltaTiles,
      ...(bmi ? [el('div', { class: 'cl' }, el('b', {}, fmtNum(bmi, 1)), el('span', {}, `BMI · ${bmiCategory(bmi)}`))] : []),
    );
  } else {
    stats.replaceChildren();
  }

  renderWeightHistory(entries);
}

function renderWeightHistory(entries) {
  const host = $('#weightHistory');
  const recent = entries.slice().reverse().slice(0, 20);

  if (!recent.length) {
    host.replaceChildren(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '🏋️'),
      el('p', {}, 'עוד לא רשמת שקילה.')));
    return;
  }

  host.replaceChildren(...recent.map((e) => el('div', { class: 'list-item weight-row' },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, formatDateHe(e.date, { withYear: true })),
    ),
    el('div', { class: 'li-side' }, fmtNum(e.weight, 1), el('small', {}, 'ק"ג')),
    el('button', {
      class: 'icon-btn', 'aria-label': 'מחק שקילה',
      onclick: guard(async () => {
        const ok = await confirmSheet('מחיקת שקילה', `למחוק את השקילה מ${formatDateHe(e.date)}?`, 'מחק');
        if (!ok) return;
        await deleteWeight(e.date);
        await renderBodyWeight();
        toast('נמחק');
      }),
    }, '🗑'),
  )));
}

/* ---------- אתחול ---------- */

export function initBodyWeight() {
  const input = $('#weightInput');
  const save = guard(async () => {
    const entriesBefore = await loadEntries();
    const prevEntry = entriesBefore[entriesBefore.length - 1];
    const newWeight = num(input.value, 0);
    const ok = await logWeight(input.value);
    if (!ok) return;
    await renderBodyWeight();
    // ירידה במשקל — מחמיאים, לא רק "נשמר" יבש
    if (prevEntry && newWeight > 0 && newWeight < prevEntry.weight) {
      toast(`ירדת ${fmtNum(prevEntry.weight - newWeight, 1)} ק"ג — כל הכבוד! 💪`, 'ok');
    } else {
      toast('השקילה נשמרה', 'ok');
    }
  });

  $('#weightSaveBtn').addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}
