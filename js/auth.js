/* ===================================================================
   auth.js — התחברות עם גוגל ואישור כניסה.

   הזרימה:
     1. המשתמש לוחץ "התחברות" ונכנס עם חשבון גוגל.
     2. נוצר עבורו מסמך ב-users/{uid} עם status: 'pending'.
     3. כל עוד הוא pending הוא רואה הודעת המתנה ולא נכנס לאפליקציה.
     4. אורי (ADMIN_EMAILS) מאושר אוטומטית, ויכול לשנות סטטוס לאחרים.
     5. status: 'blocked' חוסם כניסה גם למי שכבר נכנס בעבר.

   ה-SDK נטען מ-CDN כמודול ES — אין npm בפרויקט הזה, וזו הדרך
   היחידה לצרוך את Firebase בלי שלב בנייה.
   =================================================================== */

import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.0';

/* המצב האחרון שנרשם במכשיר. נחוץ כדי שהאפליקציה תמשיך לעבוד אופליין:
   בלי אינטרנט אי אפשר לטעון את ה-SDK או לאמת מול השרת, ואסור שזה
   ינעל משתמש שכבר אושר מחוץ לנתונים שלו. */
const LOCAL_STATE_KEY = 'oriFitnessAuthState';

function readLocalState() {
  try { return JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || 'null'); }
  catch { return null; }
}

function writeLocalState(state) {
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state)); }
  catch { /* אחסון חסום — לא קריטי */ }
}

let sdk = null;

async function loadSdk() {
  if (sdk) return sdk;
  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  sdk = {
    auth: authMod.getAuth(app),
    db: storeMod.getFirestore(app),
    ...authMod,
    ...storeMod,
  };
  return sdk;
}

function isAdmin(email) {
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((email || '').toLowerCase());
}

/**
 * מביא את רשומת המשתמש, ויוצר אותה בפעם הראשונה.
 * @returns {Promise<'approved'|'pending'|'blocked'>}
 */
async function resolveStatus(user) {
  const s = await loadSdk();
  const ref = s.doc(s.db, 'users', user.uid);
  const snap = await s.getDoc(ref);

  if (!snap.exists()) {
    const status = isAdmin(user.email) ? 'approved' : 'pending';
    await s.setDoc(ref, {
      email: user.email || '',
      name: user.displayName || '',
      photo: user.photoURL || '',
      status,
      createdAt: s.serverTimestamp(),
      lastSeen: s.serverTimestamp(),
    });
    return status;
  }

  const data = snap.data() || {};
  // אורי מאושר תמיד, גם אם הרשומה נוצרה לפני שהוגדר כמנהל
  const status = isAdmin(user.email) ? 'approved' : (data.status || 'pending');
  await s.setDoc(ref, { lastSeen: s.serverTimestamp(), status }, { merge: true });
  return status;
}

export async function signOutUser() {
  try {
    const s = await loadSdk();
    await s.signOut(s.auth);
  } finally {
    writeLocalState(null);
    location.reload();
  }
}

/** פרטי המשתמש המחובר, או null. משמש את מסך ההגדרות */
export function currentUser() {
  return readLocalState();
}

/**
 * מנהל את כל מסך הכניסה. נקרא מ-gate.js.
 * @param {{openGate:Function, closeGate:Function, setNote:Function}} ui
 */
export async function startAuthFlow({ openGate, closeGate, setNote }) {
  const btn = document.querySelector('#gateSignInBtn');
  const cached = readLocalState();

  // ---- אופליין: מסתמכים על ההחלטה האחרונה שהתקבלה מהשרת ----
  if (!navigator.onLine) {
    if (cached?.status === 'approved') { closeGate(); return; }
    openGate();
    setNote('אין חיבור לאינטרנט. צריך להתחבר פעם אחת כדי להיכנס.', 'pending');
    if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; }
    return;
  }

  let s;
  try {
    s = await loadSdk();
  } catch (err) {
    console.warn('[Ori Fitness] טעינת Firebase נכשלה:', err);
    // הרשת קיימת אבל ה-SDK לא נטען — לא נועלים מי שכבר אושר
    if (cached?.status === 'approved') { closeGate(); return; }
    setNote('לא הצלחנו להתחבר לשרת. נסה שוב מאוחר יותר.', 'denied');
    if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; }
    return;
  }

  const provider = new s.GoogleAuthProvider();

  async function handleUser(user) {
    if (!user) {
      writeLocalState(null);
      openGate();
      setNote('הכניסה באישור בעלי האפליקציה בלבד.');
      // אותו כיתוב כמו למטה: המאזין הזה רץ אחרי שהכפתור כבר הוגדר,
      // ובלי זה הוא היה דורס אותו בחזרה ל"התחברות" סתמי
      if (btn) { btn.disabled = false; btn.textContent = 'התחברות עם Google'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'בודק הרשאה…'; }

    let status;
    try {
      status = await resolveStatus(user);
    } catch (err) {
      console.warn('[Ori Fitness] בדיקת ההרשאה נכשלה:', err);
      // שסתום ביטחון: מנהל נכנס גם אם מסד הנתונים לא זמין (חוקי הרשאות
      // שעדיין לא הודבקו, מכסה שנגמרה, תקלה בצד Firebase). בלי זה תקלה
      // כזו הייתה נועלת את בעל האפליקציה מחוץ לאפליקציה שלו עצמו.
      if (isAdmin(user.email)) {
        writeLocalState({
          uid: user.uid, email: user.email || '', name: user.displayName || '',
          photo: user.photoURL || '', status: 'approved', isAdmin: true,
        });
        closeGate();
        return;
      }
      if (cached?.status === 'approved') { closeGate(); return; }
      setNote('לא הצלחנו לבדוק את ההרשאה. נסה לרענן.', 'denied');
      if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; }
      return;
    }

    writeLocalState({
      uid: user.uid,
      email: user.email || '',
      name: user.displayName || '',
      photo: user.photoURL || '',
      status,
      isAdmin: isAdmin(user.email),
    });

    if (status === 'approved') { closeGate(); return; }

    openGate();
    if (status === 'blocked') {
      setNote('הגישה שלך לאפליקציה הוסרה.', 'denied');
    } else {
      setNote(`נרשמת בהצלחה (${user.email}). הכניסה תיפתח ברגע שתאושר.`, 'pending');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'התנתק'; btn.onclick = () => signOutUser(); }
  }

  // התחברות שחזרה מ-redirect (הדרך שעובדת באפליקציה מותקנת, שבה
  // חלון קופץ נחסם) — צריך לקלוט אותה לפני שמאזינים למצב.
  try { await s.getRedirectResult(s.auth); } catch (err) {
    if (err?.code !== 'auth/no-auth-event') console.warn('[Ori Fitness] redirect:', err);
  }

  s.onAuthStateChanged(s.auth, (user) => { handleUser(user); });

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'התחברות עם Google';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'מתחבר…';
      try {
        await s.signInWithPopup(s.auth, provider);
      } catch (err) {
        // חלון קופץ נחסם (נפוץ באפליקציה מותקנת) — עוברים ל-redirect
        if (['auth/popup-blocked', 'auth/popup-closed-by-user',
             'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment']
            .includes(err?.code)) {
          try { await s.signInWithRedirect(s.auth, provider); return; }
          catch (e2) { console.warn('[Ori Fitness] redirect נכשל:', e2); }
        }
        console.warn('[Ori Fitness] התחברות נכשלה:', err);
        setNote('ההתחברות נכשלה. נסה שוב.', 'denied');
        btn.disabled = false;
        btn.textContent = 'התחברות עם Google';
      }
    };
  }
}
