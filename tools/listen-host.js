/* listen-host.js — tools/listen-loop.html's half of tools/listen-loop.mjs.
   One fresh iframe (listen-case.html) per case; the case's own fake world
   lives in that frame (listen-fake.js). Build-time only. */
(function(){
  "use strict";
  var box = document.getElementById("frames");

  function frame(mode, fault){
    return new Promise(function(res, rej){
      var f = document.createElement("iframe");
      f.src = "listen-case.html?mode=" + encodeURIComponent(mode) + (fault ? "&fault=" + encodeURIComponent(fault) : "");
      f.style.cssText = "width:900px;height:700px;border:0";
      f.onload = function(){
        var c = f.contentWindow.__case;
        if(!c){ rej(new Error("listen-case.html did not set up (" + mode + ")")); return; }
        c.ready.then(function(ok){
          if(ok !== true){ f.remove(); rej(new Error(ok)); return; }
          res(f);
        });
      };
      box.appendChild(f);
    });
  }

  window.__host = {
    selfTest: function(fault){
      return frame("say", fault).then(function(f){
        var fails = f.contentWindow.__case.selfTest();
        f.remove();
        return fails;
      });
    },
    run: function(cases, opts){
      opts = opts || {};
      window.__listenRule = opts.rule || null;
      var out = [];
      return cases.reduce(function(p, c){
        return p.then(function(){
          return frame(c.mode, opts.fault).then(function(f){
            return f.contentWindow.__case.run(c).then(function(r){ f.remove(); out.push(r); });
          }, function(e){ out.push({ id: c.id, error: String(e && e.message || e) }); });
        });
      }, Promise.resolve()).then(function(){ return out; });
    }
  };
})();
