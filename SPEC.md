# July 4th in November — Team Jeopardy Web App

Build spec for Claude Code. Build exactly what's described here; where something is unspecified, follow standard Jeopardy conventions and keep it simple.

---

## 1. Overview

A real-time, multi-device Jeopardy-style party game for ~14 players split into up to 7 teams (3–4 people each, one phone per team).

Three views, all served from one app at **https://trivia.holdenmybeer.me**:

| Route | Who | Device |
|---|---|---|
| `/tv` | Presenter screen | Laptop on HDMI to the TV, full-screen browser (1920×1080) |
| `/admin` | Host (game controller) | Host's phone |
| `/` | Team page (join + answer) | One phone per team |

Core loop:
1. Team **in control** says which clue they want out loud; the **admin** taps it on their phone.
2. Clue appears on the TV. Teams **cannot type** yet.
3. Admin finishes reading and taps **Start Timer** → 30s timer + think music. **All teams** type an answer on their phone.
4. Timer ends → whatever is in each team's textbox is submitted automatically.
5. Admin judges (auto-marked where possible, admin overrides), then reveals guesses one at a time on the TV, then shows results (green/red) and the correct answer. Every correct team gets the clue's points.
6. Control rotates to the next team. Repeat until the board is empty → Final Jeopardy → Podium.

---

## 2. Tech stack & deployment

Use **Cloudflare Workers + one Durable Object per game room**, with a **Vite + React + TypeScript** frontend served as Worker static assets. One Worker, one deploy.

- **Real-time:** WebSockets terminated in the Durable Object (`GameRoom`), using the WebSocket Hibernation API. The DO is the **single source of truth** for game state; clients are dumb renderers of state broadcasts.
- **Durable Object storage:** use a SQLite-backed DO (`new_sqlite_classes` in the migration) so it works on the Workers free plan. Persist the full game state to DO storage on **every** state change so a Worker restart or redeploy mid-game loses nothing.
- **Routing:** `wrangler.toml` with
  ```toml
  routes = [{ pattern = "trivia.holdenmybeer.me", custom_domain = true }]
  ```
  (The `holdenmybeer.me` zone is on Cloudflare.)
- **Admin PIN:** stored as a Worker secret `ADMIN_PIN` (value `6704`, set via `wrangler secret put ADMIN_PIN`). **Never** commit it or check it client-side. Verify server-side; issue an admin session token on success, stored in `localStorage`.
- **Room routing:** `idFromName(roomCode)` → `GameRoom` DO.
- **Styling:** Tailwind CSS. Fonts from Google Fonts (e.g. **Bebas Neue** for board values/headings, **Inter** for body).
- **QR code:** generate client-side (e.g. `qrcode` npm package) for the join URL.
- **Local dev:** `wrangler dev` must run the whole thing locally, and the README must explain how to test with several browser tabs acting as teams.

### Timers
The server is authoritative. When a timer starts, the DO stores `timerEndsAt` (epoch ms) and broadcasts it. Clients render the countdown from it using a server-clock offset measured on connect (ping/pong). The DO uses an **alarm** to fire the timer-end transition. Clients never decide when time is up.

---

## 3. Theme & visual design

USA / July 4th: red, white, and blue.

- Navy `#0A3161`, Red `#B31942`, White `#FFFFFF`, plus a soft off-white `#F5F1E8` and gold accent `#F2C14E` for highlights/podium.
- The board is a grid of navy tiles with big white point values (Bebas Neue). Subtle star pattern or faint stripes in backgrounds; no clutter.
- Correct = green `#2E9E5B`, wrong = red `#B31942`. These are used only for judging states.
- The TV view must be readable from a couch: clue text ≥ 56px, board values ≥ 64px, scoreboard names ≥ 28px.
- Light fireworks/confetti animations on: Daily Double reveal, correct-answer reveal, and the podium. Keep them short.

### Team icons (each team picks one; unique per game)
🦅 🗽 🇺🇸 🎆 🌭 🍔 🏈 ⚾ 🤠 🎸 🚀 🥧 🦬 🌽 🎇 🏛️

---

## 4. Audio

All audio plays **on the TV (`/tv`) only**.

| Slot | When | File path (override) |
|---|---|---|
| Think music | Loops during **every** answer timer (30s and 90s) and stops when the timer ends | `/public/audio/think.mp3` |
| Daily Double sting | When a Daily Double is revealed | `/public/audio/daily-double.mp3` |
| Timer-end buzzer | When any timer hits 0 | `/public/audio/buzzer.mp3` |
| Reveal ding | Each time a correct answer is highlighted | `/public/audio/ding.mp3` |

- If a file exists at the override path, use it. Otherwise use a **built-in fallback synthesized with the Web Audio API** (a simple, upbeat looping melody for think music; a rising fanfare for the sting; a harsh buzz; a bell ding). No copyrighted audio ships with the app.
- Browsers block autoplay. `/tv` must show a big **"Click to start the show 🔊"** overlay on first load that unlocks audio before anything else appears.
- Add a mute toggle in the admin menu.

---

## 5. Data model

### `questions.json` (loaded at build time from `/src/data/questions.json`)
See **Appendix A** for the prefilled file.

```ts
type Clue = {
  value: number;              // 200..1000
  clue: string;               // text shown on TV
  answer: string;             // canonical answer shown on reveal
  accept?: string[];          // extra accepted spellings for auto-marking
  matchMode?: "any" | "allOf";// default "any". "allOf" = every item in `accept` must appear in the answer (any order)
  image?: string;             // optional path under /public/images, shown with the clue
  dailyDouble?: boolean;
  verbal?: boolean;           // team answers out loud; no phone input; admin judges only
};
type Category = { name: string; clues: Clue[] };
type GameData = {
  title: string;
  categories: Category[];     // 6 categories × 5 clues
  final: { category: string; clue: string; answer: string; accept?: string[]; image?: string };
};
```

### Game state (lives in the Durable Object)
```ts
type Team = {
  id: string; name: string; icon: string; members: string[];
  score: number; joinOrder: number; connected: boolean; token: string;
};
type Phase =
  | "LOBBY" | "CATEGORY_INTRO" | "BOARD"
  | "CLUE_READING" | "CLUE_ANSWERING" | "CLUE_JUDGING" | "CLUE_REVEAL_GUESSES" | "CLUE_RESULTS"
  | "DD_STING" | "DD_WAGER" | "DD_READING" | "DD_ANSWERING" | "DD_RESULT"
  | "FINAL_CATEGORY" | "FINAL_WAGER" | "FINAL_READING" | "FINAL_ANSWERING" | "FINAL_REVEAL"
  | "PODIUM";
type Submission = { teamId: string; text: string; auto: "correct" | "pending"; judged: "correct" | "wrong" | null; closeMatch?: boolean };
```
Plus: `roomCode`, `phase`, `teams`, `controlTeamId`, `usedClues`, `currentClue`, `categoryIntroIndex`, `submissions`, `drafts`, `revealIndex`, `ddWager`, `finalWagers`, `timerEndsAt`, `undoStack`.

---

## 6. Screens & flow

### 6.1 Admin login & game creation
- `/admin`: PIN entry (verified server-side). After login: **Create Game** generates a 4-letter room code (no ambiguous letters such as O/0 or I/1) and opens the admin console. **Resume Game** reconnects to an existing room by code.
- `/tv?room=CODE` (also enterable by typing the code on `/tv`). The admin console shows the TV link.

### 6.2 Lobby
**TV:**
- Big room code, join URL `trivia.holdenmybeer.me`, and a QR code that links straight to `/?room=CODE`.
- Live grid of joined teams: icon, name, members. New teams animate in.

**Team page (`/`):**
1. Enter room code (prefilled from the QR link).
2. Enter team name and member names (add/remove rows, 1–6 names).
3. Pick an icon. Icons already taken are greyed out.
4. Join → waiting screen showing "You're in! 🦅 Team Name — waiting for the host…"

**Rejoin:** a team that enters the **same team name (case-insensitive) + room code** reclaims its existing team, score and all. The team page also stores `teamId + token` in `localStorage` and auto-reconnects silently if the phone locks or refreshes.

**Admin:** sees the team list, can remove or rename a team, and taps **Start Game** (enabled once ≥ 1 team has joined).

Max 7 teams. Reject further joins with a friendly message.

### 6.3 Category intro (slideshow)
- The TV shows each category name full-screen, one at a time, with a swoosh transition.
- Admin taps **Next** to advance. After the last one, **Show Board**.
- Team phones show "Get ready…"

### 6.4 Board
**TV:**
- 6×5 grid. Used clues are blank or dimmed.
- **Scoreboard bar pinned to the bottom of the TV at all times** (except the category intro and podium): every team's icon, name and score, **in join order**. The team in control is highlighted (glow/border + "🎯 IN CONTROL").

**Admin:**
- Mirrors the board as tappable tiles. Tapping a tile opens that clue.
- Also shown: current control team; buttons for **Undo**, **Edit Scores**, **Pass Control** (manual override), **Skip to Final**.

**Control order:** strictly join order (= scoreboard order). The first team to join has control first. After every clue (including Daily Doubles, and even if no team answered correctly), control moves to the next team in order, wrapping around. Disconnected teams stay in the rotation.

### 6.5 Normal clue
1. **CLUE_READING:** The tile zooms to full screen on the TV (clue text + image if present). The admin sees the clue **and the answer**. Team phones show the category + value and a **disabled** textbox labelled "Wait for the host…"
2. **Admin taps "Start Timer" → CLUE_ANSWERING:**
   - 30s timer. Think music loops on the TV.
   - TV shows a countdown bar and the scoreboard with a ✅ next to each team that has submitted (**answers are not shown**).
   - Team phones: textbox enabled, **Submit** button, and a **timer bar that shrinks** from full to empty (turning red in the last 5s). A team can edit and resubmit until time runs out.
   - Phones send their **draft text continuously** (debounced ~300ms). When the timer ends, the server locks in the latest draft for any team that didn't hit Submit. A blank draft is recorded as no answer.
   - Admin sees **all answers live** as they're typed or submitted, with auto-mark status.
   - Admin can tap **End Timer Early**.
3. **Timer ends:** buzzer plays, music stops, inputs lock → **CLUE_JUDGING**.
4. **Judging (admin only):**
   - Each submission is pre-marked by the auto-matcher (§7): **auto-correct** (green) or **pending** (grey). Blank answers are auto-wrong.
   - Pending answers that are a "close match" show a 🤏 hint.
   - The admin taps ✅ / ❌ on each one and can override auto-correct.
5. **Admin taps "Reveal Guesses" → CLUE_REVEAL_GUESSES:**
   - The TV shows each team's guess **one at a time** in scoreboard order, as neutral cards that stack up. Admin taps **Next** for each.
   - The admin can still change judgments during this step.
6. **Admin taps "Show Results" → CLUE_RESULTS:**
   - Blocked while any submission is still un-judged; the admin gets a prompt to finish judging.
   - All guess cards flip green (correct) or red (wrong), with a ding for each correct one. The correct answer appears prominently. Points animate onto the scoreboard: every correct team gets `+value`, and **wrong answers lose nothing**.
   - Team phones show "✅ Correct! +400" or "❌ The answer was …"
7. **Admin taps "Back to Board"** → control rotates → BOARD.

### 6.6 Daily Double
1. When the admin taps a Daily Double tile → **DD_STING:** full-screen "DAILY DOUBLE!" animation on the TV with the sting audio and fireworks. The category is shown.
2. **DD_WAGER:**
   - Only the **team in control** gets a wager input on its phone. Other teams see "🎯 [Team] is wagering…"
   - Allowed wager: **0 to max(teamScore, 1000)**, so a team can always bet up to 1000 even with less than 1000 or a negative score.
   - The admin can type or override the wager. The admin taps **Lock Wager**.
3. **DD_READING:** The clue is shown on the TV. The admin sees the clue and answer.
4. Admin taps **Start Timer** → **DD_ANSWERING:** 30s timer with think music.
   - If the clue is **not** `verbal`, the controlling team can type an answer (same draft/auto-submit behaviour); other teams' phones stay locked.
   - If it **is** `verbal` (e.g. the Pledge), no phones get input. The team answers out loud.
   - The admin sees the answer key the whole time and can mark ✅/❌ **at any point** (doesn't have to wait for the timer). For long answers like the Pledge, show the answer key in a large, readable block on the admin screen.
5. **DD_RESULT:** After the admin marks it, the TV shows correct/wrong for that team **and then displays the correct answer**. The score changes by ±wager.
6. **Back to Board** → control rotates as normal.

### 6.7 Final Jeopardy
Triggered automatically when the last clue is closed, or manually via **Skip to Final**.

1. **FINAL_CATEGORY:** The TV shows only the category name.
2. **FINAL_WAGER:**
   - Every team gets a wager input on its phone: **0 to max(score, 0)**. Teams at 0 or below can still play with a 0 wager.
   - The TV shows ✅ as each team locks in. Wagers are hidden.
   - Admin taps **Lock Wagers** (prompting if some teams haven't wagered; unwagered teams default to 0).
3. **FINAL_READING:** The clue is shown on the TV, and the admin sees the answer. Admin taps **Start Timer**.
4. **FINAL_ANSWERING:** **90-second** timer with think music. All teams type, with the same draft/auto-submit behaviour as normal clues.
5. **FINAL_REVEAL:**
   - Judging works like a normal clue: auto-mark plus admin override.
   - Reveal goes team by team, **from lowest score to highest** (Jeopardy-style). For each team, the TV shows the answer → green/red → the wager → the new score.
   - The admin taps **Next** for each team.
6. Admin taps **Show Winners** → **PODIUM**.

### 6.8 Podium
- The TV shows a 1st/2nd/3rd podium with icons, names, members and scores, with confetti and fireworks.
- A **full ranking of all teams** is listed underneath.
- **Ties share a place**: two teams tied for first both stand on the top step and are both winners. Use standard competition ranking (1, 1, 3…).
- Team phones show their final place.

---

## 7. Auto-marking

Normalize both the submission and every accepted answer the same way:
1. Lowercase; strip accents.
2. Remove periods and apostrophes (`u.s.a.` → `usa`, `nathan's` → `nathans`); replace hyphens and other punctuation with spaces.
3. Collapse whitespace; trim.
4. Strip a leading `the `, `a `, or `an `.

Matching:
- **`matchMode: "any"`** (default): auto-correct if the normalized submission **exactly equals** the normalized `answer` or any `accept` entry.
- **`matchMode: "allOf"`**: auto-correct if **every** `accept` item appears as a whole word or phrase somewhere in the submission, in any order (used for "name all four/five" clues).
- Anything else is **pending** for the admin. If its Levenshtein distance to any accepted answer is ≤ 2, or ≤ 20% of the answer length, flag it as a 🤏 close match. This is only a hint; it never auto-marks.

The Daily Double and `verbal` clues are always judged by the admin.

---

## 8. Admin controls (always available)

- **Undo:** reverts the last scoring action (clue results, DD result, Final reveal step, manual edit) and the control rotation that came with it. Keep a stack of state snapshots so multiple undos work.
- **Edit Scores:** set any team's score directly.
- **Pass Control:** set which team is in control.
- **Close Clue Without Scoring:** returns to the board, marks the clue used, still rotates control.
- **Remove / Rename Team.**
- **Mute audio** on the TV.
- **Reset Game:** returns to the lobby with the same teams and zero scores. Requires a confirmation.
- **Phase indicator:** the admin screen always shows the current phase and the single most likely next button, large and thumb-reachable at the bottom of the screen. The admin should be able to run the whole game by tapping one big button repeatedly.

---

## 9. Images

- Put files in `/public/images/`. Reference them in JSON as `"image": "/images/foo.jpg"`.
- On the TV the image appears under or beside the clue text, max ~55% of screen height, `object-fit: contain`. The admin sees a thumbnail. (None of the current clues use images, but the feature must work.)

---

## 10. Non-functional requirements

- Must stay smooth with 7 team phones + TV + admin connected at once.
- Phones are portrait-first; TV is landscape 1920×1080; admin is portrait.
- Every client auto-reconnects (exponential backoff) and re-renders from the full state snapshot the server sends on connect.
- The server validates everything: input only accepted during the correct phase, wagers within bounds, only the controlling team can wager on a DD, admin actions require the admin token.
- Each client only gets the state it should see: **team phones never receive answers or other teams' submissions/wagers** before reveal, and the TV never receives the answer before results.

---

## 11. Deliverables

1. Complete working app in this repo.
2. `README.md` covering: local dev (`npm run dev`), testing with multiple tabs, deploying (`wrangler deploy`), setting `ADMIN_PIN`, attaching the custom domain, where to drop the audio overrides, and how to edit `questions.json`.
3. `src/data/questions.json` prefilled from Appendix A.

### Acceptance checklist (verify before calling it done)
- [ ] 7 teams join from separate tabs, each with a unique icon; an 8th team is rejected.
- [ ] A team refreshes mid-clue and keeps its draft and score; a team rejoins by name + code on a new device.
- [ ] Inputs are locked until Start Timer; the timer bar shrinks on phones; an unsubmitted draft is auto-submitted at 0.
- [ ] Auto-marking works: `party in the u.s.a.` → correct; `7th-inning stretch` → correct; Four Corners states in any order → correct; `ohoi` → pending with 🤏.
- [ ] Multiple correct teams each get points, wrong answers lose nothing, and control rotates in join order and wraps.
- [ ] Daily Double: only the control team wagers; a team at 300 can bet 1000; the verbal Pledge clue is judged by the admin and the answer shows on the TV after marking.
- [ ] Final: a team at 0 wagers 0; the timer is 90s; the reveal goes lowest score first.
- [ ] Ties share a podium step.
- [ ] Undo restores the previous scores and control team.
- [ ] Team phones and the TV never receive answer text early (check WebSocket payloads).
- [ ] Fallback audio plays when no override files exist.

---

## Appendix A — `questions.json`

```json
{
  "title": "July 4th in November",
  "categories": [
    {
      "name": "THE PRESIDENTS",
      "clues": [
        { "value": 200, "clue": "The only president to resign. Not a crook, allegedly.", "answer": "Richard Nixon", "accept": ["nixon", "richard nixon", "richard m nixon"] },
        { "value": 400, "clue": "The other president to be assassinated in office alongside Abraham Lincoln, William McKinley, and John F. Kennedy.", "answer": "James A. Garfield", "accept": ["garfield", "james garfield", "james a garfield"] },
        { "value": 600, "clue": "This 300+ pound president had an extra-large bathtub installed in the White House.", "answer": "William Howard Taft", "accept": ["taft", "william taft", "william howard taft", "william h taft"] },
        { "value": 800, "clue": "This president is on the $50 bill.", "answer": "Ulysses S. Grant", "accept": ["grant", "ulysses grant", "ulysses s grant"] },
        { "value": 1000, "clue": "Before Donald Trump, he was the only president to serve two non-consecutive terms.", "answer": "Grover Cleveland", "accept": ["cleveland", "grover cleveland"] }
      ]
    },
    {
      "name": "WE THE PEOPLE CAN COUNT",
      "clues": [
        { "value": 200, "clue": "Number of stripes on the US flag.", "answer": "13", "accept": ["13", "thirteen"] },
        { "value": 400, "clue": "A Senator serves this many years.", "answer": "6", "accept": ["6", "six", "6 years", "six years"] },
        { "value": 600, "clue": "The House has this many voting members.", "answer": "435", "accept": ["435", "four hundred thirty five", "four hundred and thirty five"] },
        { "value": 800, "clue": "The number of justices on the Supreme Court.", "answer": "9", "accept": ["9", "nine"] },
        { "value": 1000, "clue": "The Constitution has been amended this many times.", "answer": "27", "accept": ["27", "twenty seven"] }
      ]
    },
    {
      "name": "FOUNDING FATHERS",
      "clues": [
        { "value": 200, "clue": "His giant signature on the Declaration made his name slang for \"signature.\"", "answer": "John Hancock", "accept": ["hancock", "john hancock"] },
        { "value": 400, "clue": "The first three words of the Constitution.", "answer": "We the People", "accept": ["we the people"] },
        { "value": 600, "clue": "George Washington's false teeth were famously NOT made of this.", "answer": "Wood", "accept": ["wood", "wooden"] },
        { "value": 800, "clue": "The first president to live in the White House. Spoiler: not Washington.", "answer": "John Adams", "accept": ["adams", "john adams"] },
        { "value": 1000, "clue": "In a letter, Ben Franklin trash-talked the bald eagle and praised this bird instead.", "answer": "The turkey", "accept": ["turkey", "turkeys", "wild turkey"] }
      ]
    },
    {
      "name": "GEOGRAPHY",
      "clues": [
        { "value": 200, "clue": "The second smallest state.", "answer": "Delaware", "accept": ["delaware"] },
        { "value": 400, "clue": "The only state whose name is one syllable.", "answer": "Maine", "accept": ["maine"] },
        { "value": 600, "clue": "The only state with a flag that isn't a rectangle.", "answer": "Ohio", "accept": ["ohio"] },
        { "value": 800, "clue": "The four states that meet at Four Corners.", "answer": "Utah, Colorado, Arizona, and New Mexico", "matchMode": "allOf", "accept": ["utah", "colorado", "arizona", "new mexico"] },
        { "value": 1000, "clue": "Name all five Great Lakes.", "answer": "Huron, Ontario, Michigan, Erie, and Superior", "matchMode": "allOf", "accept": ["huron", "ontario", "michigan", "erie", "superior"] }
      ]
    },
    {
      "name": "AMERICA IN POP CULTURE",
      "clues": [
        { "value": 200, "clue": "Childish Gambino's 2018 viral video.", "answer": "\"This Is America\"", "accept": ["this is america"] },
        { "value": 400, "clue": "In Night at the Museum, Robin Williams plays this president, who comes to life as a wax figure on horseback.", "answer": "Theodore Roosevelt", "accept": ["roosevelt", "teddy roosevelt", "theodore roosevelt", "teddy", "tr"] },
        { "value": 600, "clue": "Miley hopped off the plane at LAX in this 2009 hit.", "answer": "\"Party in the U.S.A.\"", "accept": ["party in the usa", "party in the us", "party in usa"] },
        { "value": 800, "clue": "Bruce Springsteen's 1984 anthem that people play at cookouts without realizing it's a protest song.", "answer": "\"Born in the U.S.A.\"", "accept": ["born in the usa", "born in the us", "born in usa"] },
        { "value": 1000, "clue": "Will Smith punches an alien and says \"Welcome to Earth\" in this 1996 movie set over the July 4th weekend.", "answer": "Independence Day", "accept": ["independence day", "id4"] }
      ]
    },
    {
      "name": "AMERICAN RITUALS",
      "clues": [
        { "value": 200, "clue": "The day after Thanksgiving, when Americans fight each other over discounted TVs.", "answer": "Black Friday", "accept": ["black friday"] },
        { "value": 400, "clue": "Animal Planet's alternative to the Super Bowl.", "answer": "The Puppy Bowl", "accept": ["puppy bowl"] },
        { "value": 600, "clue": "At baseball games, everyone sings \"Take Me Out to the Ball Game\" during this break.", "answer": "The seventh-inning stretch", "accept": ["seventh inning stretch", "7th inning stretch", "seventh inning", "7th inning"] },
        { "value": 800, "dailyDouble": true, "verbal": true, "clue": "Recite the Pledge of Allegiance. Word for word.", "answer": "I pledge allegiance to the Flag of the United States of America, and to the Republic for which it stands, one Nation under God, indivisible, with liberty and justice for all." },
        { "value": 1000, "clue": "Every February 2nd, Americans ask this Pennsylvania groundhog for a weather forecast.", "answer": "Punxsutawney Phil", "accept": ["punxsutawney phil", "punxsutawney", "phil"] }
      ]
    }
  ],
  "final": {
    "category": "THE ANTHEM",
    "clue": "Francis Scott Key wrote the lyrics while watching the British bombard this Baltimore fort during the War of 1812.",
    "answer": "Fort McHenry",
    "accept": ["fort mchenry", "ft mchenry", "mchenry", "fort mc henry"]
  }
}
```
