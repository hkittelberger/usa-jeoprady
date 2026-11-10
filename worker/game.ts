// Pure game logic. Every function mutates a GameState in place and throws
// GameError when the action isn't allowed. The Durable Object persists,
// schedules alarms and broadcasts after each successful call.

import { autoMark } from "../shared/match";
import {
  CLUE_TIME_MS, FINAL_TIME_MS, MAX_TEAMS, TEAM_ICONS,
  type AdminAction, type FinalResult, type GameData, type Phase, type Verdict,
} from "../shared/types";

export class GameError extends Error {}

export type Team = {
  id: string;
  name: string;
  icon: string;
  members: string[];
  score: number;
  joinOrder: number;
  token: string;
};

export type Submission = {
  teamId: string;
  text: string;
  auto: "correct" | "pending";
  judged: Verdict | null;
  closeMatch?: boolean;
};

type UndoEntry = {
  label: string;
  scores: Record<string, number>;
  controlTeamId: string | null;
  clueKey: string | null;
  phase: Phase;
  revealIndex: number;
  finalRevealIndex: number;
  finalResults: Record<string, FinalResult>;
};

export type GameState = {
  version: 1;
  roomCode: string;
  phase: Phase;
  teams: Team[];
  nextJoinOrder: number;
  controlTeamId: string | null;
  usedClues: string[];
  currentClue: { cat: number; idx: number } | null; // cat -1 = Final
  categoryIntroIndex: number;
  submissions: Record<string, Submission>;
  drafts: Record<string, string>;
  submitted: Record<string, boolean>;
  revealIndex: number;
  ddWager: number | null;
  ddWagerDraft: number | null;
  finalWagers: Record<string, number>;
  finalOrder: string[];
  finalRevealIndex: number;
  finalResults: Record<string, FinalResult>;
  timerEndsAt: number | null;
  timerDuration: number | null;
  timerEndSeq: number;
  timerEndReason: "timeout" | "early" | "judged" | null;
  muted: boolean;
  undoStack: UndoEntry[];
};

const UNDO_LIMIT = 50;

export function newGame(roomCode: string): GameState {
  return {
    version: 1,
    roomCode,
    phase: "LOBBY",
    teams: [],
    nextJoinOrder: 0,
    controlTeamId: null,
    usedClues: [],
    currentClue: null,
    categoryIntroIndex: 0,
    submissions: {},
    drafts: {},
    submitted: {},
    revealIndex: 0,
    ddWager: null,
    ddWagerDraft: null,
    finalWagers: {},
    finalOrder: [],
    finalRevealIndex: 0,
    finalResults: {},
    timerEndsAt: null,
    timerDuration: null,
    timerEndSeq: 0,
    timerEndReason: null,
    muted: false,
    undoStack: [],
  };
}

// ---------- helpers ----------

export const clueKey = (cat: number, idx: number) => `${cat}-${idx}`;

export function sortedTeams(s: GameState): Team[] {
  return [...s.teams].sort((a, b) => a.joinOrder - b.joinOrder);
}

export function getClueSpec(data: GameData, s: GameState) {
  const c = s.currentClue;
  if (!c) return null;
  if (c.cat === -1) {
    const f = data.final;
    return { category: f.category, value: 0, clue: f.clue, answer: f.answer, accept: f.accept, image: f.image, matchMode: "any" as const, dailyDouble: false, verbal: false };
  }
  const cat = data.categories[c.cat];
  const clue = cat.clues[c.idx];
  return { category: cat.name, ...clue };
}

function team(s: GameState, id: string): Team {
  const t = s.teams.find((t) => t.id === id);
  if (!t) throw new GameError("Unknown team");
  return t;
}

function need(s: GameState, ...phases: Phase[]) {
  if (!phases.includes(s.phase)) throw new GameError(`Not allowed during ${s.phase}`);
}

function intAmount(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) throw new GameError("Wager must be a whole number");
  return n;
}

export const ddMax = (score: number) => Math.max(score, 1000);
export const finalMax = (score: number) => Math.max(score, 0);

function randomId(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function pushUndo(s: GameState, label: string) {
  s.undoStack.push({
    label,
    scores: Object.fromEntries(s.teams.map((t) => [t.id, t.score])),
    controlTeamId: s.controlTeamId,
    clueKey: s.currentClue ? clueKey(s.currentClue.cat, s.currentClue.idx) : null,
    phase: s.phase,
    revealIndex: s.revealIndex,
    finalRevealIndex: s.finalRevealIndex,
    finalResults: structuredClone(s.finalResults),
  });
  if (s.undoStack.length > UNDO_LIMIT) s.undoStack.shift();
}

function rotateControl(s: GameState) {
  const order = sortedTeams(s);
  if (!order.length) { s.controlTeamId = null; return; }
  const i = order.findIndex((t) => t.id === s.controlTeamId);
  s.controlTeamId = order[(i + 1) % order.length].id; // i === -1 → first team
}

function clearClueState(s: GameState) {
  s.currentClue = null;
  s.submissions = {};
  s.drafts = {};
  s.submitted = {};
  s.revealIndex = 0;
  s.ddWager = null;
  s.ddWagerDraft = null;
  s.timerEndsAt = null;
  s.timerDuration = null;
}

function allCluesUsed(data: GameData, s: GameState) {
  return data.categories.every((c, ci) => c.clues.every((_, i) => s.usedClues.includes(clueKey(ci, i))));
}

function goToFinal(data: GameData, s: GameState) {
  clearClueState(s);
  s.phase = "FINAL_CATEGORY";
  s.finalWagers = {};
  s.finalOrder = [];
  s.finalRevealIndex = 0;
  s.finalResults = {};
  s.currentClue = { cat: -1, idx: 0 };
}

/** Close the current board clue: mark used, rotate control, back to board (or Final). */
function finishClue(data: GameData, s: GameState) {
  if (s.currentClue && s.currentClue.cat >= 0) {
    const k = clueKey(s.currentClue.cat, s.currentClue.idx);
    if (!s.usedClues.includes(k)) s.usedClues.push(k);
  }
  rotateControl(s);
  clearClueState(s);
  if (allCluesUsed(data, s)) goToFinal(data, s);
  else s.phase = "BOARD";
}

function startTimer(s: GameState, now: number, ms: number) {
  s.timerDuration = ms;
  s.timerEndsAt = now + ms;
}

function stopTimer(s: GameState, reason: GameState["timerEndReason"]) {
  if (s.timerEndsAt == null) return;
  s.timerEndsAt = null;
  s.timerEndSeq++;
  s.timerEndReason = reason;
}

/** Lock in every eligible team's current draft as its submission. */
function lockSubmissions(data: GameData, s: GameState, teamIds: string[]) {
  const spec = getClueSpec(data, s)!;
  for (const id of teamIds) {
    if (s.submissions[id]) continue;
    const text = (s.drafts[id] ?? "").trim();
    if (spec.verbal) {
      s.submissions[id] = { teamId: id, text, auto: "pending", judged: null };
      continue;
    }
    const m = autoMark(text, spec);
    s.submissions[id] = {
      teamId: id,
      text,
      auto: m.auto,
      // Blank → auto-wrong; auto-correct is pre-marked (admin can override).
      judged: m.blank ? "wrong" : m.auto === "correct" ? "correct" : null,
      closeMatch: m.closeMatch || undefined,
    };
  }
}

// ---------- Timer end (alarm or early) ----------

export function endTimer(data: GameData, s: GameState, reason: "timeout" | "early") {
  switch (s.phase) {
    case "CLUE_ANSWERING":
      stopTimer(s, reason);
      lockSubmissions(data, s, sortedTeams(s).map((t) => t.id));
      s.phase = "CLUE_JUDGING";
      return;
    case "DD_ANSWERING":
      if (s.timerEndsAt == null) throw new GameError("Timer is not running");
      stopTimer(s, reason);
      if (s.controlTeamId) lockSubmissions(data, s, [s.controlTeamId]);
      return; // stay in DD_ANSWERING until the admin marks it
    case "FINAL_ANSWERING": {
      stopTimer(s, reason);
      lockSubmissions(data, s, sortedTeams(s).map((t) => t.id));
      // Reveal lowest score first; ties in join order.
      s.finalOrder = [...s.teams].sort((a, b) => a.score - b.score || a.joinOrder - b.joinOrder).map((t) => t.id);
      s.finalRevealIndex = 0;
      s.finalResults = {};
      s.phase = "FINAL_REVEAL";
      return;
    }
    default:
      throw new GameError("No timer running");
  }
}

// ---------- Team actions ----------

export function joinTeam(s: GameState, name: string, members: string[], icon: string): { team: Team; rejoined: boolean } {
  name = String(name ?? "").trim().slice(0, 30);
  if (!name) throw new GameError("Please enter a team name.");
  const existing = s.teams.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return { team: existing, rejoined: true };

  if (s.teams.length >= MAX_TEAMS) throw new GameError(`Sorry — this game is full (${MAX_TEAMS} teams max). Join up with another team!`);
  const cleanMembers = (Array.isArray(members) ? members : []).map((m) => String(m ?? "").trim().slice(0, 30)).filter(Boolean).slice(0, 6);
  if (!cleanMembers.length) throw new GameError("Add at least one team member.");
  if (!TEAM_ICONS.includes(icon)) throw new GameError("Pick an icon.");
  if (s.teams.some((t) => t.icon === icon)) throw new GameError("That icon was just taken — pick another!");

  const t: Team = { id: randomId(10), name, icon, members: cleanMembers, score: 0, joinOrder: s.nextJoinOrder++, token: randomId(24) };
  s.teams.push(t);
  if (s.phase !== "LOBBY" && !s.controlTeamId) s.controlTeamId = t.id;
  return { team: t, rejoined: false };
}

function canType(s: GameState, data: GameData, teamId: string): boolean {
  if (s.phase === "CLUE_ANSWERING" || s.phase === "FINAL_ANSWERING") return s.timerEndsAt != null;
  if (s.phase === "DD_ANSWERING") {
    const spec = getClueSpec(data, s);
    return s.timerEndsAt != null && teamId === s.controlTeamId && !spec?.verbal;
  }
  return false;
}

export function teamDraft(data: GameData, s: GameState, teamId: string, text: string, submit: boolean) {
  team(s, teamId);
  if (!canType(s, data, teamId)) throw new GameError("Answers are locked right now.");
  s.drafts[teamId] = String(text ?? "").slice(0, 300);
  if (submit) s.submitted[teamId] = s.drafts[teamId].trim().length > 0;
}

export function teamDdWager(s: GameState, teamId: string, amount: number) {
  need(s, "DD_WAGER");
  if (teamId !== s.controlTeamId) throw new GameError("Only the team in control can wager.");
  const max = ddMax(team(s, teamId).score);
  const a = intAmount(amount);
  if (a < 0 || a > max) throw new GameError(`Wager must be between 0 and ${max}.`);
  s.ddWagerDraft = a;
}

export function teamFinalWager(s: GameState, teamId: string, amount: number) {
  need(s, "FINAL_WAGER");
  const max = finalMax(team(s, teamId).score);
  const a = intAmount(amount);
  if (a < 0 || a > max) throw new GameError(`Wager must be between 0 and ${max}.`);
  s.finalWagers[teamId] = a;
}

// ---------- Admin actions ----------

export function adminAction(data: GameData, s: GameState, a: AdminAction, now: number) {
  switch (a.kind) {
    case "startGame":
      need(s, "LOBBY");
      if (!s.teams.length) throw new GameError("Wait for at least one team to join.");
      s.controlTeamId = sortedTeams(s)[0].id;
      s.categoryIntroIndex = 0;
      s.phase = "CATEGORY_INTRO";
      return;

    case "nextIntro":
      need(s, "CATEGORY_INTRO");
      if (s.categoryIntroIndex < data.categories.length - 1) s.categoryIntroIndex++;
      else s.phase = "BOARD";
      return;

    case "openClue": {
      need(s, "BOARD");
      const clue = data.categories[a.cat]?.clues[a.idx];
      if (!clue) throw new GameError("No such clue");
      if (s.usedClues.includes(clueKey(a.cat, a.idx))) throw new GameError("That clue was already played");
      clearClueState(s);
      s.currentClue = { cat: a.cat, idx: a.idx };
      s.phase = clue.dailyDouble ? "DD_STING" : "CLUE_READING";
      return;
    }

    case "startTimer":
      need(s, "CLUE_READING", "DD_READING", "FINAL_READING");
      if (s.phase === "CLUE_READING") { s.phase = "CLUE_ANSWERING"; startTimer(s, now, CLUE_TIME_MS); }
      else if (s.phase === "DD_READING") { s.phase = "DD_ANSWERING"; startTimer(s, now, CLUE_TIME_MS); }
      else { s.phase = "FINAL_ANSWERING"; startTimer(s, now, FINAL_TIME_MS); }
      return;

    case "endTimer":
      endTimer(data, s, "early");
      return;

    case "judge": {
      need(s, "CLUE_JUDGING", "CLUE_REVEAL_GUESSES", "FINAL_REVEAL");
      const sub = s.submissions[a.teamId];
      if (!sub) throw new GameError("No submission for that team");
      if (s.phase === "FINAL_REVEAL" && s.finalResults[a.teamId]) throw new GameError("Already revealed — use Undo to change it.");
      sub.judged = a.verdict;
      return;
    }

    case "revealGuesses":
      need(s, "CLUE_JUDGING");
      s.revealIndex = 0;
      s.phase = "CLUE_REVEAL_GUESSES";
      return;

    case "nextGuess":
      need(s, "CLUE_REVEAL_GUESSES");
      s.revealIndex = Math.min(s.revealIndex + 1, s.teams.length);
      return;

    case "showResults": {
      need(s, "CLUE_JUDGING", "CLUE_REVEAL_GUESSES");
      const subs = Object.values(s.submissions);
      if (subs.some((x) => x.judged == null)) throw new GameError("Finish judging every answer first.");
      const value = getClueSpec(data, s)!.value;
      pushUndo(s, "Clue results");
      for (const sub of subs) if (sub.judged === "correct") team(s, sub.teamId).score += value;
      s.revealIndex = s.teams.length;
      s.phase = "CLUE_RESULTS";
      return;
    }

    case "backToBoard":
      need(s, "CLUE_RESULTS", "DD_RESULT");
      finishClue(data, s);
      return;

    case "ddContinue":
      need(s, "DD_STING");
      s.phase = "DD_WAGER";
      s.ddWagerDraft = null;
      return;

    case "setDdWager": {
      need(s, "DD_WAGER");
      if (!s.controlTeamId) throw new GameError("No team in control");
      const a2 = intAmount(a.amount);
      const max = ddMax(team(s, s.controlTeamId).score);
      if (a2 < 0 || a2 > max) throw new GameError(`Wager must be between 0 and ${max}.`);
      s.ddWagerDraft = a2;
      return;
    }

    case "lockDdWager":
      need(s, "DD_WAGER");
      if (s.ddWagerDraft == null) throw new GameError("No wager entered yet.");
      s.ddWager = s.ddWagerDraft;
      s.phase = "DD_READING";
      return;

    case "ddJudge": {
      need(s, "DD_READING", "DD_ANSWERING");
      const id = s.controlTeamId;
      if (!id || s.ddWager == null) throw new GameError("No Daily Double in progress");
      if (s.timerEndsAt != null) stopTimer(s, "judged");
      lockSubmissions(data, s, [id]);
      pushUndo(s, "Daily Double");
      s.submissions[id].judged = a.verdict;
      team(s, id).score += a.verdict === "correct" ? s.ddWager : -s.ddWager;
      s.phase = "DD_RESULT";
      return;
    }

    case "openFinalWagers":
      need(s, "FINAL_CATEGORY");
      s.phase = "FINAL_WAGER";
      return;

    case "lockFinalWagers":
      need(s, "FINAL_WAGER");
      for (const t of s.teams) if (s.finalWagers[t.id] == null) s.finalWagers[t.id] = 0;
      s.phase = "FINAL_READING";
      return;

    case "finalRevealNext": {
      need(s, "FINAL_REVEAL");
      const id = s.finalOrder[s.finalRevealIndex];
      if (!id) throw new GameError("Every team has been revealed.");
      const sub = s.submissions[id];
      if (!sub || sub.judged == null) throw new GameError(`Judge ${team(s, id).name}'s answer first.`);
      pushUndo(s, "Final reveal");
      const t = team(s, id);
      const wager = s.finalWagers[id] ?? 0;
      const before = t.score;
      t.score += sub.judged === "correct" ? wager : -wager;
      s.finalResults[id] = { before, after: t.score, wager, correct: sub.judged === "correct" };
      s.finalRevealIndex++;
      return;
    }

    case "showWinners":
      need(s, "FINAL_REVEAL");
      if (s.finalRevealIndex < s.finalOrder.length) throw new GameError("Reveal every team first.");
      s.phase = "PODIUM";
      return;

    case "undo":
      undo(s);
      return;

    case "setScore": {
      const n = intAmount(a.score);
      pushUndo(s, "Edit score");
      team(s, a.teamId).score = n;
      return;
    }

    case "passControl":
      team(s, a.teamId);
      pushUndo(s, "Pass control");
      s.controlTeamId = a.teamId;
      return;

    case "closeClue":
      need(s, "CLUE_READING", "CLUE_ANSWERING", "CLUE_JUDGING", "CLUE_REVEAL_GUESSES", "CLUE_RESULTS",
        "DD_STING", "DD_WAGER", "DD_READING", "DD_ANSWERING", "DD_RESULT");
      if (s.timerEndsAt != null) stopTimer(s, "early");
      finishClue(data, s);
      return;

    case "skipToFinal":
      need(s, "BOARD", "CATEGORY_INTRO");
      goToFinal(data, s);
      return;

    case "removeTeam": {
      const t = team(s, a.teamId);
      if (s.controlTeamId === t.id) {
        rotateControl(s);
        if (s.controlTeamId === t.id) s.controlTeamId = null;
      }
      s.teams = s.teams.filter((x) => x.id !== t.id);
      delete s.submissions[t.id];
      delete s.drafts[t.id];
      delete s.submitted[t.id];
      delete s.finalWagers[t.id];
      s.finalOrder = s.finalOrder.filter((x) => x !== t.id);
      return;
    }

    case "renameTeam": {
      const name = String(a.name ?? "").trim().slice(0, 30);
      if (!name) throw new GameError("Name can't be empty");
      if (s.teams.some((x) => x.id !== a.teamId && x.name.toLowerCase() === name.toLowerCase())) throw new GameError("Another team already has that name");
      team(s, a.teamId).name = name;
      return;
    }

    case "setMuted":
      s.muted = !!a.muted;
      return;

    case "resetGame": {
      const fresh = newGame(s.roomCode);
      fresh.teams = s.teams.map((t) => ({ ...t, score: 0 }));
      fresh.nextJoinOrder = s.nextJoinOrder;
      fresh.muted = s.muted;
      fresh.timerEndSeq = s.timerEndSeq;
      Object.assign(s, fresh);
      return;
    }

    default:
      throw new GameError("Unknown action");
  }
}

function undo(s: GameState) {
  const e = s.undoStack.pop();
  if (!e) throw new GameError("Nothing to undo");
  for (const t of s.teams) if (t.id in e.scores) t.score = e.scores[t.id];
  s.controlTeamId = e.controlTeamId && s.teams.some((t) => t.id === e.controlTeamId) ? e.controlTeamId : s.controlTeamId;

  // If we're still on the same clue, step its flow back too so it can be re-judged.
  const curKey = s.currentClue ? clueKey(s.currentClue.cat, s.currentClue.idx) : null;
  if (curKey == null || curKey !== e.clueKey) return;
  if (s.phase === "CLUE_RESULTS" && e.label === "Clue results") {
    s.phase = e.phase;
    s.revealIndex = e.revealIndex;
  } else if (s.phase === "DD_RESULT" && e.label === "Daily Double") {
    s.phase = "DD_ANSWERING";
    s.timerEndsAt = null;
    if (s.controlTeamId && s.submissions[s.controlTeamId]) s.submissions[s.controlTeamId].judged = null;
  } else if ((s.phase === "FINAL_REVEAL" || s.phase === "PODIUM") && e.label === "Final reveal") {
    s.phase = "FINAL_REVEAL";
    s.finalRevealIndex = e.finalRevealIndex;
    s.finalResults = e.finalResults;
  }
}
