/* ════════════════════════════════════════════════════════════════════
   FIREBASE CONFIG — fill this in once, then leave it alone.

   These values are NOT secrets. A Firebase web config ships to every
   browser that loads the site; it identifies the project, it does not
   authorise anything. The real security boundary is `firestore.rules`
   (published in the Firebase console), which is what actually stops a
   student reading someone else's work.

   HOW TO FILL THIS IN: see SETUP-FIREBASE.md — it walks the console
   click by click. Until the placeholders below are replaced, every page
   still loads and the games still play; sign-in just reports that it
   isn't configured yet.
   ════════════════════════════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey:            "AIzaSyA1QlmJI1M5d_XQEsslMm-4v8fzt18Sp0s",
  authDomain:        "english-intensive-98d00.firebaseapp.com",
  projectId:         "english-intensive-98d00",
  storageBucket:     "english-intensive-98d00.firebasestorage.app",
  messagingSenderId: "566881874310",
  appId:             "1:566881874310:web:f1f083c916c6baf3413c07"
};

/* The admin: the one account that sees every student, adds and removes
   teachers, and moves students between them. Repeated in isAdmin() in
   firestore.rules — keep the two in step. This half is only the UI; the
   rules are what's enforced. One address: the rules name exactly one.

   Other teachers are NOT listed here. The admin adds them on the
   dashboard (Manage → Teachers), which writes a teachers/{email}
   document; auth.js reads that document at sign-in. Each teacher sees
   only their own students. */
const ADMIN_EMAILS = [
  'jhoffman@seq.org'
];

/* Only accounts on this domain may sign in. Enforced twice on purpose:
   here for a clear message on the sign-in screen, and again in
   firestore.rules, which is the half that can't be bypassed from DevTools.
   Set to null to allow any Google account (and drop the matching check in
   the rules file, or nothing will save). */
const ALLOWED_DOMAIN = 'seq.org';
