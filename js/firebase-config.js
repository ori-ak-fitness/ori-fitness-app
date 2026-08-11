/* ===================================================================
   firebase-config.js — פרטי החיבור לפרויקט Firebase.

   כל עוד apiKey ריק, שער הכניסה כבוי לגמרי והאפליקציה עובדת
   בדיוק כמו קודם, בלי התחברות. ברגע שממלאים כאן את הערכים
   מקונסולת Firebase (Project settings > Your apps > Web app),
   השער נדלק והכניסה נעשית באישור בלבד.

   הערכים האלה אינם סוד — הם נחשפים ממילא בכל אפליקציית ווב.
   מה שמגן על הנתונים אלה חוקי האבטחה (Security Rules) בצד Firebase.
   =================================================================== */

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

/** כתובות המייל שמנהלות את האפליקציה — מאשרות ומסירות משתמשים */
export const ADMIN_EMAILS = [
  'oritikshuv2007@gmail.com',
];

export function isConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}
