# English Intensive

Plain static HTML/JS games and activities for English language practice.
No build step and no dependencies.

Serve it over HTTPS (GitHub Pages) or `http://localhost` — **not** by opening
the files off disk. Chrome's speech recognition and microphone access both
require a secure context, so the games will not listen from a `file://` URL.

```bash
python3 -m http.server 8000
```

## Home page

`index.html` shows a grid of game tiles. Add a new game by dropping an entry
in the `GAMES` array in its inline `<script>` — `icon`, `title`,
`description`, `url`.

## Blend games

`blend-game.js` + `blend-game.css` are a shared engine for the "say the word
out loud" phonics games. A game page is just a word list:

```html
<link rel="stylesheet" href="blend-game.css">
<div id="app"></div>
<script src="blend-game.js"></script>
<script>
BlendGame.start({
  title: "Starting Blends 🎤",
  blend: "start",              // "start" or "end" — which end the blend is on
  words: ["blip","crop","clam"]
});
</script>
```

The engine renders every screen, so adding a game means copying one of the
existing pages and swapping the word list. Chrome only — it uses the Web
Speech API.

Current games:

- `blend-words-game.html` — words **ending** in a consonant blend.
- `initial-blends-game.html` — words **starting** with a consonant blend.

### How the listening works

The mic is not push-to-talk. Each game opens on a mic-check screen with a live
level meter, then the mic stays on for the whole game, only pausing while the
computer is actually speaking words out loud (the coach's praise, "The word
was...", or "Hear it") — never for the short feedback beeps, so it doesn't
have to reconnect between words. Silence never counts as a wrong answer.

The Web Speech API has no gain or sensitivity setting, so the **Listening**
button on the start screen controls how forgiving the *matching* is instead.
Matching compares **sounds**, not letters — a small rule-based phonetic
encoder in `blend-game.js` (`phonemes()`) — so "krab" now passes for "crab"
even though the recogniser rarely spells it that way, while "bled" still
never passes for "bred":

| Level | Accepts |
| --- | --- |
| Strict | the exact word only |
| Normal (default) | the rest of the word off by one sound |
| Forgiving | the rest of the word off by two |

"Off by one/two sounds" is now literally true: it's phoneme-level edit
distance, with a swapped vowel sound costing half as much as any other
change (recognisers mangle vowels far more than consonants). At every level
the blend must be exactly right in phoneme space — "bred" never passes for
"bled" — since that is the skill being practised. A small curated table in
`blend-game.js` (`ACCEPT`) also covers a couple of known recogniser
mishearings (e.g. "gasp" heard as "gas"); add more there as you notice them
in class. The Listening setting is remembered per device in `localStorage`,
same as Shuffle.

Run `tests.html` (served the same way as the games) to check the matcher
itself — it renders a pass/fail table with a summary line.

If a student's correct answers keep getting marked wrong, check the meter on
the mic-check screen first: a quiet input is an OS-level microphone setting
(ChromeOS → Settings → Device → Audio → Input), not something the page can fix.

### Correct/wrong feedback

Right and wrong answers are shown visually — a green "✓ +10" or red "✗"
pop-up over the word, plus a matching glow on the card and colored status
text — so nothing depends on the student hearing anything.

The **Voice** button (default **Off**, remembered per device like the other
settings) turns on a short spoken coach on top of that: quick praise on a
correct answer ("Nice!", "Got it!"…, with a bigger call-out every 5-streak),
and the word spoken aloud after the second miss. Press **H** any time during
play to hear the current word read at a slower pace — same as clicking "Hear
it" — regardless of the Voice setting. All speech picks the best available
`en-US` voice (`pickVoice()` in `blend-game.js`), preferring Chrome/ChromeOS's
natural voice over the flat default, and re-picks once Chrome finishes
loading its voice list.
