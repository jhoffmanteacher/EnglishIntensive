# Firebase setup — do this once

The site needs a Firebase project for two things: Google sign-in, and one
small database of student practice records. This is a **new, separate
project** from the guitar-class one, so reading-class data and guitar data
never share a database or a rules file.

Free tier covers a class of this size many times over — the whole class
generates a few hundred document writes a day against a 20,000/day quota.

Budget about ten minutes. Steps 1–5 are the console; step 6 is this repo.

---

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in as
   **jhoffman@seq.org**.
2. **Create a project** → name it `english-intensive`.
3. Google Analytics: **turn it off**. Nothing here uses it and it's one
   fewer consent question about student data.
4. Wait for "Your new project is ready" → **Continue**.

## 2. Turn on Google sign-in

1. Left sidebar → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Google** → toggle **Enable**.
3. Support email: pick your own address. **Save**.
4. Leave every other provider **disabled**. Email/Password in particular:
   the rules trust `email_verified`, and an unverified provider is the one
   way an outside account could ever look like a school one.

## 3. Authorize the site's domain

Still in **Authentication** → **Settings** tab → **Authorized domains**.

Add the domain the site is served from — for GitHub Pages that's
`jhoffmanteacher.github.io`. `localhost` is already on the list, which is
what makes Live Server work.

Sign-in fails with `auth/unauthorized-domain` if this is missed. That is
the single most common setup mistake.

## 4. Create the database

1. Left sidebar → **Build → Firestore Database** → **Create database**.
2. Location: **nam5 (us-central)** — or any US multi-region.
3. Start in **production mode** (locked). The next step replaces the rules
   anyway, and starting locked means there is never a window where the
   database is world-readable.

## 5. Publish the rules

1. Firestore Database → **Rules** tab.
2. Open `firestore.rules` from this repo, copy the whole file, paste it
   over whatever is in the box, **Publish**.

**This is the actual security of the site.** Everything else — the
sign-in wall, the @seq.org check, the teacher dashboard's account check —
runs in the student's own browser and can be switched off from DevTools.
These rules run on Google's servers and cannot.

Re-paste them any time `firestore.rules` changes in the repo. GitHub Pages
does not deploy rules; nothing does but this box.

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
browser that loads the site; it names the project, it doesn't authorise
anything. The rules are what decide who may read what.

## 7. Check it

1. Open the site. You should get the sign-in wall.
2. Sign in with **jhoffman@seq.org**. You land on the games page, with a
   "Teacher dashboard →" link under the tiles.
3. Play one round of any game. Back in the console, **Firestore Database →
   Data** should now show a `students` collection with one document.
4. Open the dashboard — you should be the only row.

If sign-in bounces you back to the wall with a message about a personal
account, you're signed in to Chrome as a personal Google account: pick the
@seq.org one in the popup.

---

## Later: adding a second teacher

The teacher account is hard-coded in two places that must agree:
`TEACHER_EMAIL` in `firebase-config.js`, and the address inside
`isTeacher()` in `firestore.rules`. For a second teacher, change
`isTeacher()` to a membership test:

```
return isSchool() && request.auth.token.email in [
  'jhoffman@seq.org',
  'someone.else@seq.org'
];
```

…and republish the rules. The dashboard's own check would need widening
too, but remember which of the two is real: the rules.

## Later: a different school domain

`seq.org` appears in three places: `ALLOWED_DOMAIN` in
`firebase-config.js`, the `matches()` pattern in `firestore.rules`, and
the `isTeacher()` address. Change all three, republish the rules.
