/* ===================================================================
   gate.js — שער הכניסה לאפליקציה.

   מצב א׳ (היום): Firebase עדיין לא הוגדר — השער נסגר מיד והאפליקציה
   נפתחת כרגיל. זה מכוון: כל עוד אין מאחורי מה לאמת, נעילה הייתה רק
   חוסמת את השימוש בלי להוסיף שום אבטחה.

   מצב ב׳ (ברגע שממלאים firebase-config.js): השער נשאר סגור עד
   שהמשתמש מתחבר ומאושר. אישור נשמר בצד Firebase, ולכן הסרה של
   משתמש נכנסת לתוקף גם אם האפליקציה כבר מותקנת אצלו.
   =================================================================== */

import { $ } from './ui.js';
import { isConfigured } from './firebase-config.js';

const GATE_OPEN_CLASS = 'gate-open';

function openGate() {
  document.body.classList.add(GATE_OPEN_CLASS);
  $('#welcomeGate')?.classList.remove('hidden');
}

function closeGate() {
  document.body.classList.remove(GATE_OPEN_CLASS);
  $('#welcomeGate')?.classList.add('hidden');
}

function setNote(text, state = '') {
  const note = $('#gateNote');
  if (!note) return;
  note.textContent = text;
  note.className = 'gate-note' + (state ? ' is-' + state : '');
}

/**
 * @returns {Promise<boolean>} האם מותר להמשיך לאפליקציה
 */
export async function initGate() {
  if (!isConfigured()) {
    // אין עדיין פרויקט Firebase — לא נועלים את האפליקציה על עצמה
    closeGate();
    return true;
  }

  openGate();
  setNote('הכניסה באישור בעלי האפליקציה בלבד.');

  const btn = $('#gateSignInBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'טוען…';
  }

  try {
    const auth = await import('./auth.js');
    await auth.startAuthFlow({ openGate, closeGate, setNote });
    return false; // auth.js סוגר את השער בעצמו כשהמשתמש מאושר
  } catch (err) {
    console.warn('[Ori Fitness] טעינת ההתחברות נכשלה:', err);
    setNote('לא הצלחנו לטעון את מסך ההתחברות. נסה לרענן.', 'denied');
    if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; }
    return false;
  }
}
