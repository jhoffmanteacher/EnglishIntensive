/* ════════════════════════════════════════════════════════════════════
   auth.js — Google sign-in wall, shared by every page on the site.

   Adapted from the guitar-class site's app.js auth section. The hard-won
   parts are kept verbatim in spirit and the comments explaining WHY are
   kept with them, because every one of them is a bug that already
   happened once on a school Chromebook:

     · the two-state wall (a button-free "checking…" note vs. the actual
       Sign in with Google button) — a wall that shows a live sign-in
       button while a sign-in is still resolving gets clicked twice, and
       the second popup makes Firebase reject the first
     · the re-entrancy guard on signIn()
     · the stall escape hatch — a Firestore read on a network that accepts
       connections and then stalls retries forever rather than failing
     · sign-out as a hard reload, so nothing from one student on a shared
       Chromebook survives into the next
     · a visible message when the Firebase SDK never arrives at all
       (school content filters do block gstatic.com)

   Unlike the guitar site, the wall's MARKUP lives here rather than in
   each page's HTML: this site has eight pages and counting, and eight
   copies of the same 40 lines would drift. Pages opt out by setting
   `window.EI_REQUIRE_AUTH = false` before this script — tests.html does,
   since it exercises pure functions and needs no account.

   Public API:
     EIAuth.ready()      → Promise resolving to the signed-in user
     EIAuth.user         → the user, or null before sign-in
     EIAuth.isTeacher()  → true if signed in as one of TEACHER_EMAILS
     EIAuth.db()         → Promise resolving to Firestore (SDK loaded on
                           demand — see ensureDb)
     EIAuth.signOut()
   ════════════════════════════════════════════════════════════════════ */

window.EIAuth = (function(){
  "use strict";

  var REQUIRE = window.EI_REQUIRE_AUTH !== false;

  /* ---------------- Firebase init ----------------
     The SDK and the config load as separate <script>s. On some school
     networks a content filter blocks gstatic.com, so they may never
     arrive — guard instead of throwing and leaving a blank page. */
  var auth = null, db = null;
  var configured = typeof firebaseConfig !== "undefined" &&
                   String(firebaseConfig.projectId || "").indexOf("PASTE_") !== 0;
  var sdkReady = typeof firebase !== "undefined" && typeof firebaseConfig !== "undefined";

  if(sdkReady && configured){
    try{
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      // Firestore (~100 KB) is deliberately NOT initialised here. ensureDb()
      // pulls it in on the first read or write — i.e. only after sign-in —
      // so the sign-in screen paints without waiting on it.
    }catch(e){ auth = null; }
  }

  /* Accepts a list (TEACHER_EMAILS) or, from an older config, a single
     string (TEACHER_EMAIL). Normalising both to an array here means a
     stale firebase-config.js degrades to one teacher rather than locking
     the dashboard for everyone. */
  var TEACHERS = (function(){
    var v = (typeof TEACHER_EMAILS !== "undefined") ? TEACHER_EMAILS
          : (typeof TEACHER_EMAIL  !== "undefined") ? TEACHER_EMAIL
          : null;
    if(v == null) return [];
    return (typeof v === "string") ? [v] : v.slice();
  })();
  var DOMAIN  = (typeof ALLOWED_DOMAIN !== "undefined") ? ALLOWED_DOMAIN : null;

  var user = null;
  var readyResolve = null;
  var readyPromise = new Promise(function(res){ readyResolve = res; });

  /* ---------------- Firestore SDK, loaded on demand ---------------- */
  var _firestoreLoad = null;
  function loadFirestoreSdk(){
    if(_firestoreLoad) return _firestoreLoad;
    _firestoreLoad = new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js";
      s.onload = function(){ resolve(); };
      // Remove the failed tag so a later retry doesn't pile up orphaned
      // <script> elements in <head> on every attempt.
      s.onerror = function(){ s.remove(); _firestoreLoad = null; reject(new Error("Firestore SDK failed to load")); };
      document.head.appendChild(s);
    });
    return _firestoreLoad;
  }
  function ensureDb(){
    if(db) return Promise.resolve(db);
    if(!auth) return Promise.resolve(null);
    return loadFirestoreSdk().then(function(){
      db = firebase.firestore();
      return db;
    });
  }

  /* ---------------- the wall ---------------- */
  var wall = null, stallTimer = null, revealTimer = null;

  var GOOGLE_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>' +
    '<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>' +
    '<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>' +
    '<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>' +
    "</svg>";

  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  function buildWall(){
    if(wall) return wall;
    wall = document.createElement("div");
    wall.id = "ei-auth-wall";
    wall.className = "ei-wall";
    wall.innerHTML =
      '<div class="ei-wall-card">' +
        '<div class="ei-wall-logo" aria-hidden="true">🎮</div>' +
        '<h1>English Intensive</h1>' +
        // State 1 — the button-free note. Default on every load, because
        // Firebase needs a moment to decide whether an existing session is
        // still good, and flashing a sign-in page at a student who is
        // already signed in is what teaches them to click it again.
        '<div id="ei-wall-checking">' +
          '<p id="ei-wall-msg" class="ei-wall-note">Checking your sign-in…</p>' +
          // Revealed by the 20 s stall timer. Taking the button away during
          // the load is what fixes the double sign-in, but it leaves the
          // student with no button at all — this is the way out.
          '<div id="ei-wall-stalled" hidden>' +
            '<p class="ei-wall-note">This is taking longer than usual — the network may be slow. Your work is safe.</p>' +
            '<button class="btn ghost" id="ei-wall-reload">Try again</button>' +
          '</div>' +
        '</div>' +
        // State 2 — the real sign-in button, shown only on a genuine
        // "signed out" answer (or the 6 s safety timeout below).
        '<div id="ei-wall-signin" hidden>' +
          '<p class="ei-wall-note">Sign in with your school Google account to practice and save your progress.</p>' +
          '<button class="btn ei-btn-google" id="ei-wall-btn">' + GOOGLE_SVG + '<span>Sign in with Google</span></button>' +
          '<p class="ei-wall-fine">Use your <b>@' + esc(DOMAIN || "school") + '</b> account.</p>' +
          '<button class="ei-dev-bypass" id="ei-dev-bypass" hidden>Dev bypass</button>' +
        '</div>' +
        '<p class="ei-wall-error" id="ei-wall-error" hidden></p>' +
      '</div>';
    document.body.appendChild(wall);
    wall.querySelector("#ei-wall-btn").addEventListener("click", signIn);
    wall.querySelector("#ei-wall-reload").addEventListener("click", function(){ location.reload(); });
    var dev = wall.querySelector("#ei-dev-bypass");
    if(IS_LOCALHOST){ dev.hidden = false; dev.addEventListener("click", devBypass); }
    return wall;
  }

  function showWall(){
    buildWall();
    wall.hidden = false;
    document.documentElement.classList.add("ei-locked");
  }
  function hideWall(){
    if(wall) wall.hidden = true;
    document.documentElement.classList.remove("ei-locked");
  }
  function wallError(msg){
    buildWall();
    var el = wall.querySelector("#ei-wall-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  // Swap the wall to the button-free note, and retag the line.
  function wallChecking(msg){
    buildWall();
    var m = wall.querySelector("#ei-wall-msg");
    if(m) m.textContent = msg;
    wall.querySelector("#ei-wall-checking").hidden = false;
    wall.querySelector("#ei-wall-signin").hidden = true;
    clearStall();
  }
  function wallSignIn(){
    buildWall();
    clearStall();
    wall.querySelector("#ei-wall-checking").hidden = true;
    wall.querySelector("#ei-wall-signin").hidden = false;
  }
  /* A wait that has stopped being normal. 20 s is well past a slow-but-
     working school-Wi-Fi load, so a student who is merely waiting never
     sees this. Reloading is always safe here: the sign-in is already
     persisted, so they come back signed in rather than to the wall. */
  function startStall(){
    clearTimeout(stallTimer);
    stallTimer = setTimeout(function(){
      var el = wall && wall.querySelector("#ei-wall-stalled");
      if(el) el.hidden = false;
    }, 20000);
  }
  function clearStall(){
    clearTimeout(stallTimer); stallTimer = null;
    var el = wall && wall.querySelector("#ei-wall-stalled");
    if(el) el.hidden = true;
  }

  // Shown when the SDK or the config never loaded (blocked on school Wi-Fi),
  // or when firebase-config.js still holds its placeholders.
  function showSetupError(title, body){
    buildWall();
    wall.querySelector(".ei-wall-card").innerHTML =
      '<div class="ei-wall-logo" aria-hidden="true">⚠️</div>' +
      "<h1>" + esc(title) + "</h1>" +
      '<p class="ei-wall-note">' + esc(body) + "</p>" +
      '<button class="btn ghost" onclick="location.reload()">Try again</button>';
    showWall();
  }

  /* ---------------- the user chip ---------------- */
  function userChipHtml(u){
    // Google account values are user-controlled and go into innerHTML.
    var av = u.photoURL
      ? '<img src="' + esc(u.photoURL) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="ei-chip-init">' + esc((u.displayName || u.email || "?")[0].toUpperCase()) + "</span>";
    return av +
      '<span class="ei-chip-name">' + esc(firstName(u)) + "</span>" +
      '<button class="ei-chip-out" id="ei-chip-out" title="Sign out">Sign out</button>';
  }
  function renderChip(u){
    var el = document.getElementById("ei-user-chip");
    if(!el){
      el = document.createElement("div");
      el.id = "ei-user-chip";
      el.className = "ei-chip";
      document.body.appendChild(el);
    }
    el.innerHTML = userChipHtml(u);
    el.hidden = false;
    var out = el.querySelector("#ei-chip-out");
    if(out) out.addEventListener("click", signOut);
  }
  function firstName(u){
    var n = (u.displayName || "").trim();
    if(n) return n.split(/\s+/)[0];
    return (u.email || "").split("@")[0];
  }

  /* ---------------- sign in / out ---------------- */
  var popupPending = false;

  function signIn(){
    /* Re-entrancy guard. A second click is never useful and is sometimes
       destructive: a second signInWithPopup while the first is still open
       makes Firebase reject the FIRST one with
       auth/cancelled-popup-request, so the student's completed sign-in is
       thrown away and they have to start over. */
    if(popupPending || user) return;
    if(!auth){ wallError("Sign-in isn't set up yet."); return; }
    wallError("");
    // Pre-warm the Firestore SDK while the student is in the Google popup,
    // so it's ready the moment they're back. Errors ignored — the real
    // load attempt surfaces any problem.
    loadFirestoreSdk().catch(function(){});
    popupPending = true;
    var provider = new firebase.auth.GoogleAuthProvider();
    // A hint, not a guarantee: Google honours `hd` by pre-filtering the
    // account chooser, but a determined student can still pick a personal
    // account. The real domain check is the one in onAuthStateChanged
    // below, and behind that the one in firestore.rules.
    if(DOMAIN) provider.setCustomParameters({ hd: DOMAIN });
    try{
      auth.signInWithPopup(provider)
        .catch(function(e){
          // Closing the popup isn't an error worth nagging about.
          if(e && (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request")) return;
          wallError("Sign-in didn't work. Try again.");
        })
        .finally(function(){ popupPending = false; });
    }catch(e){
      // Nothing attached the .finally() above, so clear the flag here or
      // the guard locks the button out for the rest of the visit.
      popupPending = false;
      wallError("Sign-in didn't work. Try again.");
    }
  }

  /* Sign-out on a shared Chromebook has to be a hard reset, not a state
     reset: per-student state lives in module closures, sessionStorage and
     rendered DOM as well as in the variables here, and an ever-growing
     manual reset list drifts out of sync. Reloading clears the lot. */
  function signOut(){
    var done = function(){ location.reload(); };
    try{
      // Flush anything the store still has queued while we're still
      // authenticated as this student — a save dropped here is a round of
      // practice the next sign-in won't know happened.
      var flush = (window.EIStore && window.EIStore.flush) ? window.EIStore.flush() : Promise.resolve();
      Promise.resolve(flush)
        .catch(function(){})
        .then(function(){ try{ sessionStorage.clear(); }catch(e){} })
        .then(function(){ return auth ? auth.signOut().catch(function(){}) : null; })
        .then(done, done);
    }catch(e){ done(); }
  }

  /* Dev bypass is for local UI testing only — never on the live site.
     It never signs in to Firebase Auth, so Firestore rules reject every
     write under this uid; EIStore checks isDev() and stays local. */
  var IS_LOCALHOST = ["localhost","127.0.0.1","[::1]",""].indexOf(location.hostname) !== -1;
  function devBypass(){
    if(!IS_LOCALHOST){ return; }
    user = { uid:"dev-user", displayName:"Dev User", email:"dev@" + (DOMAIN || "test.local"), photoURL:null, _dev:true };
    hideWall(); renderChip(user);
    readyResolve(user);
  }
  function isDev(){ return !!(user && user._dev); }

  /* ---------------- the auth state machine ---------------- */
  function wrongDomain(email){
    if(!DOMAIN) return false;
    return String(email || "").toLowerCase().slice(-(DOMAIN.length + 1)) !== "@" + DOMAIN;
  }

  function boot(){
    if(!REQUIRE){ readyResolve(null); return; }
    if(!sdkReady){
      showSetupError("Can't reach Google right now",
        "The sign-in service didn't load. This usually means the school network blocked it — try again, or tell your teacher.");
      return;
    }
    if(!configured){
      showSetupError("Sign-in isn't set up yet",
        "firebase-config.js still has its placeholder values. See SETUP-FIREBASE.md.");
      return;
    }
    showWall();
    // Safety net: if onAuthStateChanged somehow never fires, the student
    // still gets a button rather than an eternal "checking…" note.
    revealTimer = setTimeout(wallSignIn, 6000);

    auth.onAuthStateChanged(function(u){
      clearTimeout(revealTimer);
      if(!u){
        user = null;
        var chip = document.getElementById("ei-user-chip");
        if(chip) chip.hidden = true;
        wallSignIn();      // a real signed-out answer — checking is over
        showWall();
        return;
      }
      if(wrongDomain(u.email)){
        // Not an error the student can fix by clicking again, so say what
        // went wrong and drop the session rather than leaving them signed
        // in to an account the database will refuse anyway.
        var bad = u.email;
        auth.signOut().catch(function(){});
        wallSignIn();
        wallError("That's a personal account (" + bad + "). Sign in with your @" + DOMAIN + " school account.");
        return;
      }
      user = u;
      /* They're in — but the page is still a Firestore round trip or two
         from ready. Take the sign-in button off the screen NOW, before any
         await, or the student spends that wait looking at a sign-in page
         they just came back from and signs in a second time. */
      wallChecking("Loading your words…");
      renderChip(u);
      startStall();
      // Everything downstream (EIStore, EIPractice, the dashboard) waits
      // on this promise and takes the wall down when it has what it needs.
      readyResolve(u);
    });
  }

  // Called by whoever finished loading (EIPractice, teacher.js) once the
  // page is actually ready to show. Kept separate from readyResolve so the
  // wall covers the Firestore load too, not just the sign-in.
  function unlock(){ clearStall(); hideWall(); }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  return {
    ready: function(){ return readyPromise; },
    get user(){ return user; },
    uid: function(){ return user ? user.uid : null; },
    isTeacher: function(){ return !!(user && TEACHERS.indexOf(user.email) !== -1); },
    isDev: isDev,
    db: ensureDb,
    signIn: signIn,
    signOut: signOut,
    unlock: unlock,
    fail: function(title, body){ showSetupError(title, body); },
    _internals: { wrongDomain: wrongDomain, firstName: firstName }
  };
})();
