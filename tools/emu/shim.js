/* Served only by tools/emu/harness.mjs, never by the site: it points the
   real Firebase SDK at the emulators on this machine, and stands in for
   Google's sign-in popup. Everything else on the page is the site's own
   code, SDK included.

   Inserted right after the firebase-auth-compat <script> tag, so it runs
   before auth.js calls initializeApp. */
(function(){
  "use strict";
  var AUTH = "__AUTH__", FS_HOST = "__FS_HOST__", FS_PORT = __FS_PORT__;
  var init = firebase.initializeApp.bind(firebase);

  firebase.initializeApp = function(cfg){
    if(String(cfg.projectId).indexOf("demo-") !== 0) throw new Error("emu shim: not a demo project");
    var app = init(cfg);
    var auth = firebase.auth();
    auth.useEmulator(AUTH, { disableWarnings: true });
    /* The one thing replaced: Google's popup. The site's button, its
       signIn() and its domain check all run; the account picked is the one
       the loop wrote to localStorage before it clicked. */
    auth.signInWithPopup = function(){
      var who = JSON.parse(localStorage.getItem("__emu.who"));
      return auth.signInWithCredential(
        firebase.auth.GoogleAuthProvider.credential(JSON.stringify(who)));
    };
    return app;
  };

  /* auth.js adds the Firestore SDK on demand. A capture listener hears the
     script's load before the script's own onload does, which is before
     anything has had a chance to use the database. */
  var pointed = false;
  document.addEventListener("load", function(e){
    var s = e.target;
    if(!pointed && s && s.tagName === "SCRIPT" && /firebase-firestore-compat/.test(s.src)){
      pointed = true;
      firebase.firestore().useEmulator(FS_HOST, FS_PORT);
    }
  }, true);
})();
