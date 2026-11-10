# 🎆 July 4th in November — Team Jeopardy

A real-time, multi-device Jeopardy-style party game. One Cloudflare Worker serves the React app and routes WebSockets to a Durable Object (`GameRoom`), one per room, which holds the game state.

| Route    | Who                                 |
|----------|-------------------------------------|
| `/tv`    | Presenter screen (laptop → TV, 1920×1080, full screen) |
| `/admin` | Host's phone (PIN-protected)        |
| `/`      | One phone per team                  |

## Project layout

```
worker/           Cloudflare Worker + Durable Object
  index.ts        HTTP API (/api/admin/login, /api/rooms, /api/ws/:code) → assets
  room.ts         GameRoom Durable Object (WebSocket Hibernation API, alarms, storage)
  game.ts         Pure game logic / state machine
  views.ts        Per-role state filtering (what each client may see)
  auth.ts         Admin PIN check + signed session tokens
shared/           Types + auto-marking shared by server and client
src/              Vite + React + Tailwind frontend (pages/Tv, pages/Admin, pages/Team)
src/data/questions.json   The game content (bundled into the Worker only; never shipped to browsers)
public/audio/     Optional audio overrides
public/images/    Clue images
test/             Vitest tests for matching, game flow and payload filtering
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars    # then set ADMIN_PIN in .dev.vars (e.g. ADMIN_PIN=6704)
npm run dev                       # vite build + wrangler dev → http://localhost:8787
```

`npm run dev` builds the frontend once and starts `wrangler dev`, which runs the Worker, the Durable Object (with local SQLite storage in `.wrangler/`) and the static assets together. If you're editing the frontend, use `npm run dev:watch`, which rebuilds on save; refresh the browser to pick up changes.

Other scripts:

```bash
npm test            # vitest: auto-marking, game flow, undo, wagers, no-leak checks
npm run typecheck   # tsc for the frontend (use `npx tsc -p tsconfig.worker.json` for the worker)
npm run build       # production build of the frontend into dist/
```

### Testing with several browser tabs

Every tab is its own client, so one computer can play every role:

1. **Host:** open `http://localhost:8787/admin`, enter the PIN from `.dev.vars`, and tap **Create Game**. Note the 4-letter room code.
2. **TV:** open `http://localhost:8787/tv?room=CODE` (the admin lobby shows this link). Click **"Click to start the show 🔊"** to unlock audio.
3. **Teams:** teams keep their login in `localStorage`, and tabs in the same browser profile share it. So give each team its own profile, or use incognito/private windows or different browsers:
   - Chrome: one normal window, one Incognito window, plus extra profiles (profile menu → *Add*).
   - Or mix Chrome, Firefox, Safari and their private windows.

   Open `http://localhost:8787/?room=CODE` in each and join with a different name and icon. Chrome DevTools' device toolbar (Ctrl/Cmd+Shift+M) gives a phone-sized view.
4. To test with real phones on your Wi-Fi, run `npx wrangler dev --ip 0.0.0.0` (after `npm run build`) and open `http://<your-laptop-ip>:8787` on the phones.

Things worth trying: refresh a team tab mid-clue (the draft and score come back), close a team's window and rejoin from another by typing the same team name, try an 8th team (it's rejected), and use Undo after scoring.

## Deploying

```bash
npx wrangler login
npx wrangler secret put ADMIN_PIN     # enter 6704 when prompted. Never commit it.
npm run deploy                        # vite build && wrangler deploy
```

The Durable Object uses SQLite storage (`new_sqlite_classes` migration), so it runs on the Workers **free plan**. Game state is written to storage on every change, so a redeploy or restart mid-game loses nothing. Clients reconnect on their own and get the full state back.

### Custom domain

`wrangler.toml` already contains:

```toml
routes = [{ pattern = "trivia.holdenmybeer.me", custom_domain = true }]
```

The `holdenmybeer.me` zone is on Cloudflare, so `wrangler deploy` creates the DNS record and certificate for `trivia.holdenmybeer.me` automatically. Make sure there is no existing DNS record for `trivia`, or the deploy will report a conflict. You can also attach it in the dashboard under **Workers & Pages → july4-jeopardy → Settings → Domains & Routes → Add → Custom domain**.

## Running the game

- **Admin** (`/admin`): log in with the PIN → **Create Game** (or **Resume Game** by code). The big button at the bottom is always the next step, so you can run the whole game by tapping it. The ☰ menu has Undo, Edit Scores, Pass Control, Close Clue Without Scoring, Skip to Final, Rename/Remove Teams, Mute TV and Reset Game.
- **TV** (`/tv?room=CODE`): click once to unlock audio, then press F11 for full screen.
- **Teams** scan the QR code on the TV. That opens `/?room=CODE` with the code filled in.

Timers run on the server. The Durable Object stores `timerEndsAt` and sets an alarm for it. Clients only draw the countdown, using a clock offset measured with ping/pong. When time runs out, the latest draft in each team's textbox is locked in, even if the team never pressed Submit.

## Audio

All audio plays on the TV only. To use your own sounds, drop files at these paths and redeploy (or rebuild for local dev):

| Slot | File |
|------|------|
| Think music (loops during every answer timer) | `public/audio/think.mp3` |
| Daily Double sting | `public/audio/daily-double.mp3` |
| Timer-end buzzer | `public/audio/buzzer.mp3` |
| Correct-answer ding | `public/audio/ding.mp3` |

Any slot without a file uses a built-in sound synthesized with the Web Audio API: an original upbeat loop, a rising fanfare, a harsh buzz and a bell ding. No copyrighted audio ships with the app.

## Editing `questions.json`

`src/data/questions.json` has 6 categories × 5 clues plus a Final:

```jsonc
{
  "value": 800,
  "clue": "The four states that meet at Four Corners.",
  "answer": "Utah, Colorado, Arizona, and New Mexico",   // shown on reveal
  "accept": ["utah", "colorado", "arizona", "new mexico"],  // extra accepted spellings
  "matchMode": "allOf",     // optional: every `accept` item must appear (any order)
  "image": "/images/four-corners.jpg",  // optional, file in public/images/
  "dailyDouble": true,      // optional
  "verbal": true            // optional: answered out loud, admin judges (no phone input)
}
```

Auto-marking lowercases the text, strips accents, periods and apostrophes, turns other punctuation into spaces, collapses whitespace and drops a leading "the/a/an". With the default `matchMode` (`"any"`), an answer is auto-correct when it equals the `answer` or any `accept` entry after this cleanup. Anything else waits for the admin, with a 🤏 hint when it's within Levenshtein distance 2, or 20% of the answer's length. Daily Doubles are always judged by the admin.

The questions are compiled into the Worker, so rebuild/redeploy after editing. Browsers never download the file: clients only see category names, values, and clue text once it's revealed.

### Images

Put files in `public/images/` and reference them as `"image": "/images/foo.jpg"`. The TV shows the image under the clue, up to about half the screen height (`object-fit: contain`). The admin sees a thumbnail.

## Privacy rules (enforced server-side in `worker/views.ts`)

- Team phones never receive the answer key, other teams' answers or other teams' wagers before the reveal.
- The TV never receives the answer before results, and never sees Final wager amounts until each team is revealed.
- Admin actions need a valid admin session token. The PIN is checked only on the server, against the `ADMIN_PIN` secret.
