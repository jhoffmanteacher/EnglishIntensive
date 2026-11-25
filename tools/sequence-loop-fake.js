/* sequence-loop-fake.js — build-time check, not part of the site.

   tools/sequence-loop.mjs serves the site's pages with their two gstatic
   Firebase tags (firebase-app-compat, firebase-auth-compat) replaced by
   this one script, which runs where they ran: after firebase-config.js and
   before auth.js. It asks the harness page that holds this frame
   (tools/sequence-loop.html) for the fake `firebase` — one Auth and one
   Firestore shared by every frame — and installs it. A page opened any
   other way finds no harness and says so in its title, rather than
   pretending to be signed in. */
(function(){
  "use strict";
  var H = null;
  try{ H = window.parent && window.parent !== window ? window.parent.SEQ_HARNESS : null; }catch(e){ H = null; }
  if(!H){ document.title = "sequence-loop: no harness"; return; }
  H.install(window);
})();
