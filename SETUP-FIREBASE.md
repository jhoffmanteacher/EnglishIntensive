# Firebase setup — do this once

The site needs a Firebase project for two things: Google sign-in, and one
small database of student practice records. This is a **new, separate
project** from the guitar-class one, so reading-class and guitar data never
share a database or a rules file.

The free tier covers a class this size many times over: a few hundred
document writes a day against a 20,000/day quota.

Budget about ten minutes. Steps 1–5 are the console; step 6 is this repo.

---

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in as
   **jhoffman@seq.org**.
2. **Create a project** → name it `english-intensive`. Firebase adds a
   suffix to make the project *id* unique. Ours is
   `english-intensive-98d00`, and that is the id every command below wants,
   not the name typed here.
3. Google Analytics: **turn it off**. Nothing here uses it, and it's one
   fewer consent question about student data.
4. Wait for "Your new project is ready" → **Continue**.

## 2. Turn on Google sign-in

1. Left sidebar → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Google** → toggle **Enable**.
3. Support email: pick your own address. **Save**.
4. Leave every other provider **disabled**. Email/Password in particular:
   the rules trust `email_verified`, and an unverified provider is the one
   way an outside account could look like a school one.

## 3. Authorize the site's domain

Still in **Authentication** → **Settings** tab → **Authorized domains**.

Add the domain the site is served from. For GitHub Pages that's
`jhoffmanteacher.github.io`. `localhost` is already on the list, which is
what makes Live Server work.

Missing this gives `auth/unauthorized-domain` at sign-in, the most common
setup mistake.

## 4. Create the database

1. Left sidebar → **Build → Firestore Database** → **Create database**.
2. Location: **nam5 (us-central)**, or any US multi-region.
3. Start in **production mode** (locked). The next step replaces the rules
   anyway, and starting locked means the database is never world-readable.

## 5. Publish the rules

1. Firestore Database → **Rules** tab.
2. Open `firestore.rules` from this repo, copy the whole file, paste it over
   whatever is in the box, **Publish**.

**This is the actual security of the site.** Everything else — the sign-in
wall, the @seq.org check, the teacher dashboard's account check — runs in
the student's own browser and can be switched off from DevTools. These rules
run on Google's servers and cannot.

Re-paste them whenever `firestore.rules` changes. GitHub Pages does not
deploy rules; only this box does.

A machine can do it instead, but only where the Firebase CLI is already
logged in:

```
firebase deploy --only firestore:rules --project english-intensive-98d00
```

`firebase projects:list` says whether it is. Logging in needs a browser, so
on a headless machine this is a person's job.

## 6. Fill in `firebase-config.js`

1. Console → the **gear icon** next to Project Overview → **Project
   settings**.
2. Scroll to **Your apps** → click the **web icon** (`</>`).
3. App nickname: `English Intensive site`. Do **not** tick "Firebase
   Hosting" — the site lives on GitHub Pages.
4. **Register app.** The next screen shows a `firebaseConfig` block.
5. Copy each value into `firebase-config.js` in this repo, replacing the
   `PASTE_..._HERE` placeholders. Commit and push.

These values are **not secrets**. A Firebase web config ships to every
browser that loads the site; it names the project and authorises nothing.
The rules decide who may read what.

## 7. Check it

1. Open the site. You should get the sign-in wall.
2. Sign in with **jhoffman@seq.org**. You land on the games page, with a
   "Teacher dashboard →" link under the tiles.
3. Play one round of any game. Back in the console, **Firestore Database →
   Data** should now show a `students` collection with one document.
4. Open the dashboard. You should be the only row.

If sign-in bounces you back to the wall with a message about a personal
account, Chrome is signed in to a personal Google account. Pick the @seq.org
one in the popup.

---

## After this change ships: classes, and adding the other teachers

Periods are gone; **classes** replace them. A class ("P3 Intensive") has a
name and one or more teachers, and every student is in exactly one class.
Any teacher on a class can add or remove co-teachers on it; only the admin
adds or removes teachers on the site.

No teacher but the admin is written in the code. `jhoffman@seq.org` is the
one admin — `ADMIN_EMAILS` in `firebase-config.js` and `isAdmin()` in
`firestore.rules` — and every other teacher is added on the dashboard.
**The other teachers are not seeded** — not in the config, not in the rules.
Add each of them yourself, once, after the deploy below.

Deploy in this order — **rules first**, because the new dashboard reads
`classes/`, which the old rules refuse, so the new site on the old rules
would show "Couldn't load the class":

1. **Publish the rules.** Paste the new `firestore.rules` into Firestore
   Database → Rules → Publish. The new rules accept everything the old site
   writes from a student's browser, so publishing them before the site
   changes breaks no student. (Until step 2 the old dashboard still loads
   for you — you are the admin — but adding a period there won't save, and
   it no longer loads for anyone else, which is the point.)
2. **Merge to `main` and push.** GitHub Pages picks it up in a minute or
   two.
3. **Open the dashboard as jhoffman@seq.org.** The first admin load turns
   every period into a class taught by you ("3" becomes a class called
   *3*), puts every student, roster row, assignment and note in their
   class, and puts students with no period in a class called *No class
   yet*. It does this quietly; reload once and everyone is still there.
   Rename the classes under **Classes** if you like ("3" → "P3 Intensive").
4. **Add the teachers**: Manage → Teachers → *Add a teacher*, one at a time,
   with their @seq.org address and a name. Each gets the dashboard the next
   time they sign in.
5. **Share or hand over classes**: under **Classes**, *Add a co-teacher* on
   each class they teach. To hand a class over entirely, add them, then
   remove yourself. Or move single students with the *Class* box on a
   student's page. A teacher can also import their own roster into a new
   class — an import claims a student who has no roster row yet, and skips
   (and names) anyone already in another class.

## Later: adding or removing a teacher

Manage → Teachers → *Add a teacher* writes a `teachers/{email}` document;
*Remove* deletes it — which alone ends their access — and takes them off
every class. Only the admin can do either; the rules refuse writes to that
collection from everyone else. Removing is refused while they are the only
teacher on a class: add another teacher to it, or move its students, first.
No student, class or practice is ever deleted by it.

## Later: a different admin

Change the address in `ADMIN_EMAILS` (`firebase-config.js`) **and** in
`isAdmin()` (`firestore.rules`), then republish the rules. The two must
agree: the config decides whether the admin controls render, the rules
decide whether the database lets them work. Classes the old admin teaches
stay theirs until someone adds a co-teacher.

## Later: a different school domain

`seq.org` appears in four places: `ALLOWED_DOMAIN` in `firebase-config.js`,
the `matches()` pattern in `firestore.rules`, the `isAdmin()` address, and
the `@seq.org` check on the dashboard's *Add a teacher* box
(`TEACHER_EMAIL_RE` in `teacher.js`). Change all four, then republish the
rules.
