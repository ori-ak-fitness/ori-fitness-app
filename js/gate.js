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
 * מחזיר Promise שנפתר רק כשמותר להיכנס לאפליקציה.
 *
 * חשוב: הפונקציה הזו לא יכולה פשוט להחזיר false כשיש התחברות —
 * main() ממתין לה כדי לדעת מתי לאתחל את האפליקציה. אם היא תסתיים
 * לפני שהמשתמש אושר, השער אמנם ייסגר אבל שום מסך לא ייטען, והמשתמש
 * יראה ממשק ריק שלא מגיב. לכן ההבטחה נפתרת בדיוק ברגע האישור.
 *
 * @returns {Promise<boolean>}
 */
/*
 * חוסם את הלחיצה על "התחברות" כל עוד תיבת ההסכמה לא מסומנת — בשלב
 * ה-capture, לפני שה-listener של auth.js (המוקצה ל-onclick, לא
 * addEventListener) בכלל מקבל את האירוע. כך זה לא נוגע ולא מתחרה עם
 * ניהול ה-disabled/onclick הדינמי שכבר קיים שם לכל שאר מצבי הכפתור.
 */
function requireConsent(btn) {
  const check = $('#gateConsentCheck');
  const label = check?.closest('.gate-consent');
  if (!check) return;
  btn.addEventListener('click', (e) => {
    if (check.checked) { label?.classList.remove('is-required'); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    label?.classList.add('is-required');
    check.focus();
  }, true);
  check.addEventListener('change', () => {
    if (check.checked) label?.classList.remove('is-required');
  });
}

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
    requireConsent(btn);
  }

  return new Promise((resolve) => {
    let released = false;
    // נקרא כשהמשתמש מאושר. onAuthStateChanged עשוי לירות יותר מפעם
    // אחת, ולכן משחררים את האפליקציה רק בפעם הראשונה.
    const grantAccess = () => {
      closeGate();
      if (released) return;
      released = true;
      resolve(true);
    };

    import('./auth.js')
      .then((auth) => auth.startAuthFlow({ openGate, closeGate: grantAccess, setNote }))
      .catch((err) => {
        console.warn('[Ori Fitness] טעינת ההתחברות נכשלה:', err);
        setNote('לא הצלחנו לטעון את מסך ההתחברות. נסה לרענן.', 'denied');
        if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; }
      });
  });
}
