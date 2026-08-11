/* ===================================================================
   backup.js — ייצוא וייבוא של כל הנתונים כקובץ JSON.
   התמונות לא נכללות בכוונה, כדי שהקובץ יישאר קטן וניתן לשליחה.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, openSheet, closeSheet, confirmSheet,
  dateKey, fmtNum, guard, heCount, pickFileOnce,
} from './ui.js';

const FORMAT = 'ori-fitness-backup';
const FORMAT_VERSION = 1;

/** מפתחות ב-settings שלא נכון להעביר למכשיר אחר */
const SKIP_SETTINGS = new Set(['activeWorkout']);

let onRestored = null;

/* ---------- ייצוא ---------- */

export async function buildBackup() {
  const [workouts, meals, goals, routines, mealPlan, bodyWeight, settings] = await Promise.all([
    db.getAll(db.STORES.workouts),
    db.getAll(db.STORES.meals),
    db.getAll(db.STORES.goals),
    db.getAll(db.STORES.routines),
    db.getAll(db.STORES.mealPlan),
    db.getAll(db.STORES.bodyWeight),
    db.getAll(db.STORES.settings),
  ]);

  // ארוחות נשמרות בלי ה-Blob של התמונה
  const leanMeals = meals.map(({ photo, thumb, ...rest }) => ({ ...rest, hadPhoto: !!(photo || thumb) }));

  // מאגר routines מחזיק גם תוכניות כוח וגם סוגי אירובי — מפרידים לספירה
  const strengthRoutines = routines.filter((r) => (r.kind ?? 'strength') === 'strength');
  const cardioTypes = routines.filter((r) => r.kind === 'cardio');
  const strengthWorkouts = workouts.filter((w) => (w.kind ?? 'strength') === 'strength');
  const cardioSessions = workouts.filter((w) => w.kind === 'cardio');

  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      workouts: strengthWorkouts.length,
      cardioSessions: cardioSessions.length,
      meals: leanMeals.length,
      goals: goals.length,
      routines: strengthRoutines.length,
      cardioTypes: cardioTypes.length,
      mealPlan: mealPlan.length,
      bodyWeight: bodyWeight.length,
    },
    data: {
      workouts,
      meals: leanMeals,
      goals,
      routines,
      mealPlan,
      bodyWeight,
      settings: settings.filter((s) => !SKIP_SETTINGS.has(s.key)),
    },
  };
}

function backupFilename() {
  return `ori-fitness-backup-${dateKey()}.json`;
}

async function exportToFile() {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = el('a', { href: url, download: backupFilename() });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return { json, backup };
}

async function copyToClipboard(json) {
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

async function openExportSheet() {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const sizeKb = Math.max(1, Math.round(new Blob([json]).size / 1024));
  const c = backup.counts;

  const textarea = el('textarea', {
    readonly: true, rows: 6, style: 'font-family:monospace;font-size:.72rem;direction:ltr',
  });
  textarea.value = json;

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'הגיבוי כולל אימונים, ארוחות, יעדים, תוכניות ותפריט. תמונות לא נכללות — כדי שהקובץ יישאר קטן.'),

    el('div', { class: 'summary-grid', style: 'margin-bottom:16px' },
      el('div', { class: 'sg' }, el('b', {}, String(c.workouts)), el('span', {}, 'אימונים')),
      el('div', { class: 'sg' }, el('b', {}, String(c.meals)), el('span', {}, 'ארוחות')),
      el('div', { class: 'sg' }, el('b', {}, String(c.routines)), el('span', {}, 'תוכניות')),
      el('div', { class: 'sg' }, el('b', {}, String(c.bodyWeight)), el('span', {}, 'שקילות')),
      el('div', { class: 'sg' }, el('b', {}, `${sizeKb}KB`), el('span', {}, 'גודל הקובץ')),
    ),

    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        await exportToFile();
        toast('הקובץ יורד', 'ok');
      }),
    }, `הורד ${backupFilename()}`),

    el('p', { class: 'muted', style: 'margin:16px 0 8px' },
      'אם ההורדה חסומה (קורה בתצוגה מקדימה) — העתק את הטקסט ושמור אותו איפה שנוח לך:'),

    el('button', {
      class: 'btn btn-secondary btn-block',
      onclick: guard(async function () {
        const ok = await copyToClipboard(json);
        if (ok) { toast('הגיבוי הועתק', 'ok'); return; }
        textarea.select();
        toast('סמן והעתק ידנית', 'err');
      }),
    }, 'העתק את הגיבוי כטקסט'),

    el('div', { class: 'field', style: 'margin-top:12px' }, textarea),
  );

  openSheet('ייצוא גיבוי', body);
}

/* ---------- ייבוא ---------- */

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('הקובץ אינו קובץ גיבוי תקין');
  if (parsed.format !== FORMAT) throw new Error('זה לא קובץ גיבוי של Ori Fitness');
  if (!parsed.data || typeof parsed.data !== 'object') throw new Error('הקובץ פגום — חסרים נתונים');
  if (parsed.version > FORMAT_VERSION) throw new Error('הקובץ נוצר בגרסה חדשה יותר של האפליקציה');
  return parsed;
}

const STORE_BY_KEY = {
  workouts:   db.STORES.workouts,
  meals:      db.STORES.meals,
  goals:      db.STORES.goals,
  routines:   db.STORES.routines,
  mealPlan:   db.STORES.mealPlan,
  bodyWeight: db.STORES.bodyWeight,
  settings:   db.STORES.settings,
};

/** רוב המאגרים ממוזגים לפי id, אבל settings לפי key ושקילות לפי התאריך עצמו */
function keyFieldFor(store) {
  if (store === db.STORES.settings) return 'key';
  if (store === db.STORES.bodyWeight) return 'date';
  return 'id';
}

/**
 * @param {object} backup
 * @param {'merge'|'replace'} mode
 */
async function restore(backup, mode) {
  const summary = { added: 0, replaced: 0 };

  for (const [key, store] of Object.entries(STORE_BY_KEY)) {
    const rows = Array.isArray(backup.data[key]) ? backup.data[key] : [];

    if (mode === 'replace') {
      await db.clearStore(store);
      for (const row of rows) { await db.put(store, row); summary.replaced++; }
      continue;
    }

    // מיזוג: רשומה קיימת (לפי מזהה) לא נדרסת
    const existing = await db.getAll(store);
    const keyField = keyFieldFor(store);
    const known = new Set(existing.map((r) => r[keyField]));
    for (const row of rows) {
      if (known.has(row[keyField])) continue;
      await db.put(store, row);
      summary.added++;
    }
  }
  return summary;
}

async function handleBackupText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // לא מציגים את הודעת הדפדפן — היא באנגלית ולא אומרת כלום למשתמש
    toast('הטקסט אינו קובץ גיבוי. ודא שהעתקת את הכל.', 'err', 4200);
    return;
  }

  let backup;
  try {
    backup = validate(parsed);
  } catch (err) {
    toast(err.message, 'err', 4200);
    return;
  }

  const c = backup.counts || {};
  const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString('he-IL') : 'לא ידוע';

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:12px' }, `גיבוי מתאריך ${when}`),
    el('div', { class: 'summary-grid', style: 'margin-bottom:18px' },
      el('div', { class: 'sg' }, el('b', {}, String(c.workouts ?? 0)), el('span', {}, 'אימונים')),
      el('div', { class: 'sg' }, el('b', {}, String(c.meals ?? 0)), el('span', {}, 'ארוחות')),
      el('div', { class: 'sg' }, el('b', {}, String(c.routines ?? 0)), el('span', {}, 'תוכניות')),
      el('div', { class: 'sg' }, el('b', {}, String(c.mealPlan ?? 0)), el('span', {}, 'פריטי תפריט')),
      el('div', { class: 'sg' }, el('b', {}, String(c.bodyWeight ?? 0)), el('span', {}, 'שקילות')),
    ),

    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        const s = await restore(backup, 'merge');
        closeSheet();
        onRestored?.();
        toast(s.added ? `נוספו ${s.added} רשומות` : 'הכל כבר היה קיים', 'ok');
      }),
    }, 'הוסף למה שקיים'),
    el('p', { class: 'muted', style: 'margin:8px 0 16px;font-size:.8rem' },
      'רשומות שכבר קיימות אצלך יישארו כמו שהן. זו האפשרות הבטוחה.'),

    el('button', {
      class: 'btn btn-ghost btn-block',
      onclick: guard(async () => {
        const ok = await confirmSheet('החלפת כל הנתונים',
          'כל האימונים, הארוחות והתוכניות שקיימים עכשיו יימחקו ויוחלפו בגיבוי. אין דרך חזרה.', 'החלף הכל');
        if (!ok) return;
        const s = await restore(backup, 'replace');
        closeSheet();
        onRestored?.();
        toast(`הנתונים הוחלפו (${s.replaced} רשומות)`, 'ok');
      }),
    }, 'החלף את כל הנתונים'),
  );

  openSheet('ייבוא גיבוי', body);
}

async function openImportSheet() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    closeSheet();
    await handleBackupText(text);
  });

  const pasteArea = el('textarea', {
    rows: 5, placeholder: 'או הדבק כאן את טקסט הגיבוי',
    style: 'font-family:monospace;font-size:.72rem;direction:ltr',
  });

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'בחר קובץ גיבוי, או הדבק את הטקסט שהעתקת.'),

    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => pickFileOnce(fileInput),
    }, 'בחר קובץ גיבוי'),
    fileInput,

    el('div', { class: 'field', style: 'margin-top:18px' }, pasteArea),
    el('button', {
      class: 'btn btn-secondary btn-block',
      onclick: guard(async () => {
        const text = pasteArea.value.trim();
        if (!text) { toast('הדבק קודם את הטקסט', 'err'); return; }
        closeSheet();
        await handleBackupText(text);
      }),
    }, 'טען מהטקסט'),
  );

  openSheet('ייבוא גיבוי', body);
}

/* ---------- תצוגה ---------- */

export async function renderBackupInfo() {
  const backup = await buildBackup();
  const c = backup.counts;
  const total = c.workouts + c.cardioSessions + c.meals + c.routines + c.mealPlan + c.bodyWeight;
  $('#backupInfo').textContent = total
    ? `${heCount(c.workouts + c.cardioSessions, 'אימון', 'אימונים')} · ` +
      `${heCount(c.meals, 'ארוחה', 'ארוחות', true)} · ` +
      `${heCount(c.routines, 'תוכנית', 'תוכניות', true)}`
    : 'אין עדיין נתונים לגיבוי';
}

/* ---------- אתחול ---------- */

export function initBackup({ onImported } = {}) {
  onRestored = onImported;
  $('#exportBackupBtn').addEventListener('click', guard(openExportSheet));
  $('#importBackupBtn').addEventListener('click', guard(openImportSheet));
}
