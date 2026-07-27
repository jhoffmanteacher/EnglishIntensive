# English Intensive

Plain static HTML/JS games and activities for English language practice.
No build step — open `index.html` directly in a browser.

## Home page

`index.html` shows a grid of game tiles. Add a new game by dropping an entry
in the `GAMES` array in its inline `<script>` — `icon`, `title`,
`description`, `url`.

## Games

- `blend-words-game.html` — voice-based phonics game. Reads a consonant-blend
  word aloud on screen; the student says it into the mic and Chrome's speech
  recognition checks the answer. Chrome only (uses the Web Speech API).
