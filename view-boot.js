/* Applies the student's Reading view before the page paints.

   The real settings object lives in localStorage under "eiView" and
   game-core.js owns it. This file reads only the derived class string
   game-core.js caches beside it, because it has to run in <head>, before
   any stylesheet or script, and everything it does has to fit in the
   time before first paint. Without it a student with Lexend on watches
   every page render in the default face and then jump.

   The regex is the whole safety story: localStorage is hand-editable, so
   nothing but lowercase letters, hyphens and spaces reaches className.
   A missing, cleared or stale cache costs one frame — game-core.js
   re-derives the classes from the real object as soon as it loads. */
(function(){
  try{
    var cls = (localStorage.getItem("eiViewClass") || "").replace(/[^a-z\- ]/g, "");
    if(cls) document.documentElement.className += " " + cls;
  }catch(e){}
})();
