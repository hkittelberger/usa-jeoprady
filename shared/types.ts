// Types shared by the Worker (Durable Object) and the React client.

export type Clue = {
  value: number;
  clue: string;
  answer: string;
  accept?: string[];
  matchMode?: "any" | "allOf";
  image?: string;
  dailyDouble?: boolean;
  verbal?: boolean;
};
export type Category = { name: string; clues: Clue[] };
export type GameData = {
  title: string;
  categories: Category[];
  final: { category: string; clue: string; answer: string; accept?: string[]; image?: string };
};

export type Phase =
  | "LOBBY" | "CATEGORY_INTRO" | "BOARD"
  | "CLUE_READING" | "CLUE_ANSWERING" | "CLUE_JUDGING" | "CLUE_REVEAL_GUESSES" | "CLUE_RESULTS"
  | "DD_STING" | "DD_WAGER" | "DD_READING" | "DD_ANSWERING" | "DD_RESULT"
  | "FINAL_CATEGORY" | "FINAL_WAGER" | "FINAL_READING" | "FINAL_ANSWERING" | "FINAL_REVEAL"
  | "PODIUM";

export type Verdict = "correct" | "wrong";

export type PublicTeam = {
  id: string;
  name: string;
  icon: string;
  members: string[];
  score: number;
  joinOrder: number;
  connected: boolean;
};

/** The clue as a given client is allowed to see it. */
export type ViewClue = {
  cat: number; // -1 = Final Jeopardy
  idx: number;
  category: string;
  value: number;
  clue: string;
  image?: string;
  dailyDouble?: boolean;
  verbal?: boolean;
  answer?: string; // only present when the role is allowed to see it
};

export type ViewSubmission = {
  teamId: string;
  submitted: boolean; // team has an answer in (✅)
  text?: string;
  auto?: "correct" | "pending";
  judged?: Verdict | null;
  closeMatch?: boolean;
};

export type FinalResult = { before: number; after: number; wager: number; correct: boolean };

export type Role = "admin" | "tv" | "team" | "guest";

export type View = {
  role: Role;
  roomCode: string;
  title: string;
  phase: Phase;
  teams: PublicTeam[]; // join order
  controlTeamId: string | null;
  board: { name: string; values: number[]; dailyDoubles?: boolean[] }[];
  usedClues: string[]; // "cat-idx"
  categoryIntroIndex: number;
  currentClue: ViewClue | null;
  timerEndsAt: number | null;
  timerDuration: number | null; // ms
  timerEndSeq: number; // increments each time a timer ends (for the buzzer)
  timerEndReason: "timeout" | "early" | "judged" | null;
  submissions: ViewSubmission[];
  revealIndex: number; // CLUE_REVEAL_GUESSES: how many guesses are shown
  ddWager: number | null;
  ddWagerDraft: number | null; // admin + control team only
  ddMax: number | null;
  finalCategory: string;
  finalWagersLocked: string[]; // teamIds that locked a wager
  finalWagers: Record<string, number>; // only what the role may see
  finalOrder: string[];
  finalRevealIndex: number;
  finalResults: Record<string, FinalResult>;
  muted: boolean;
  undoCount: number;
  me: null | {
    teamId: string;
    draft: string;
    submitted: boolean;
    finalWager: number | null;
    finalMax: number;
  };
};

// ---- Wire protocol ----

export type ClientMsg =
  | { type: "hello"; role: "admin"; token: string }
  | { type: "hello"; role: "tv" }
  | { type: "hello"; role: "team"; teamId?: string; token?: string }
  | { type: "ping"; t: number }
  | { type: "join"; name: string; members: string[]; icon: string }
  | { type: "draft"; text: string }
  | { type: "submit"; text: string }
  | { type: "ddWager"; amount: number }
  | { type: "finalWager"; amount: number }
  | { type: "admin"; action: AdminAction };

export type AdminAction =
  | { kind: "startGame" }
  | { kind: "nextIntro" }
  | { kind: "openClue"; cat: number; idx: number }
  | { kind: "startTimer" }
  | { kind: "endTimer" }
  | { kind: "judge"; teamId: string; verdict: Verdict | null }
  | { kind: "revealGuesses" }
  | { kind: "nextGuess" }
  | { kind: "showResults" }
  | { kind: "backToBoard" }
  | { kind: "ddContinue" }
  | { kind: "setDdWager"; amount: number }
  | { kind: "lockDdWager" }
  | { kind: "ddJudge"; verdict: Verdict }
  | { kind: "openFinalWagers" }
  | { kind: "lockFinalWagers" }
  | { kind: "finalRevealNext" }
  | { kind: "showWinners" }
  | { kind: "undo" }
  | { kind: "setScore"; teamId: string; score: number }
  | { kind: "passControl"; teamId: string }
  | { kind: "closeClue" }
  | { kind: "skipToFinal" }
  | { kind: "removeTeam"; teamId: string }
  | { kind: "renameTeam"; teamId: string; name: string }
  | { kind: "setMuted"; muted: boolean }
  | { kind: "resetGame" };

export type ServerMsg =
  | { type: "state"; view: View }
  | { type: "pong"; t: number; server: number }
  | { type: "joined"; teamId: string; token: string }
  | { type: "error"; message: string }
  | { type: "authFailed" };

export const TEAM_ICONS = ["🦅", "🗽", "🇺🇸", "🎆", "🌭", "🍔", "🏈", "⚾", "🤠", "🎸", "🚀", "🥧", "🦬", "🌽", "🎇", "🏛️"];
export const MAX_TEAMS = 7;
export const CLUE_TIME_MS = 30_000;
export const FINAL_TIME_MS = 90_000;
