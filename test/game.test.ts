import { describe, expect, it } from "vitest";
import questions from "../src/data/questions.json";
import { autoMark, normalize } from "../shared/match";
import type { GameData } from "../shared/types";
import { adminAction, endTimer, joinTeam, newGame, teamDdWager, teamDraft, teamFinalWager, type GameState } from "../worker/game";
import { buildView } from "../worker/views";

const data = questions as GameData;
const clue = (cat: number, idx: number) => data.categories[cat].clues[idx];
const icons = ["🦅", "🗽", "🇺🇸", "🎆", "🌭", "🍔", "🏈", "⚾"];

function setup(n = 3): GameState {
  const s = newGame("ABCD");
  for (let i = 0; i < n; i++) joinTeam(s, `Team ${i}`, [`P${i}`], icons[i]);
  adminAction(data, s, { kind: "startGame" }, 0);
  for (let i = 0; i < 6; i++) adminAction(data, s, { kind: "nextIntro" }, 0);
  expect(s.phase).toBe("BOARD");
  return s;
}
const id = (s: GameState, i: number) => s.teams[i].id;

describe("auto-marking", () => {
  it("normalizes", () => {
    expect(normalize("The U.S.A.")).toBe("usa");
    expect(normalize("Nathan's  hot-dogs")).toBe("nathans hot dogs");
    expect(normalize("Café")).toBe("cafe");
  });
  it("spec examples", () => {
    expect(autoMark("party in the u.s.a.", clue(4, 2)).auto).toBe("correct");
    expect(autoMark("7th-inning stretch", clue(5, 2)).auto).toBe("correct");
    expect(autoMark("New Mexico, arizona, COLORADO and utah", clue(3, 3)).auto).toBe("correct");
    expect(autoMark("utah colorado arizona", clue(3, 3)).auto).toBe("pending");
    const o = autoMark("ohoi", clue(3, 2));
    expect(o).toMatchObject({ auto: "pending", closeMatch: true });
    expect(autoMark("Garfeild", clue(0, 1)).closeMatch).toBe(true);
    expect(autoMark("Lincoln", clue(0, 1)).closeMatch).toBe(false);
    expect(autoMark("   ", clue(0, 1)).blank).toBe(true);
  });
});

describe("game flow", () => {
  it("rejects 8th team, unique icons, rejoin by name", () => {
    const s = newGame("ABCD");
    for (let i = 0; i < 7; i++) joinTeam(s, `T${i}`, ["a"], icons[i]);
    expect(() => joinTeam(s, "T8", ["a"], icons[7])).toThrow(/full/);
    expect(joinTeam(s, "t3", [], "").rejoined).toBe(true);
    const s2 = newGame("ABCD");
    joinTeam(s2, "A", ["a"], "🦅");
    expect(() => joinTeam(s2, "B", ["b"], "🦅")).toThrow(/taken/);
  });

  it("normal clue: inputs locked, drafts auto-submitted, multiple correct, rotation wraps, undo", () => {
    const s = setup(3);
    expect(s.controlTeamId).toBe(id(s, 0));
    adminAction(data, s, { kind: "openClue", cat: 4, idx: 2 }, 0);
    expect(() => teamDraft(data, s, id(s, 0), "x", false)).toThrow(/locked/);
    adminAction(data, s, { kind: "startTimer" }, 1000);
    expect(s.timerEndsAt).toBe(31000);
    teamDraft(data, s, id(s, 0), "party in the u.s.a.", true);
    teamDraft(data, s, id(s, 1), "Party in the USA!", false); // never hit submit
    teamDraft(data, s, id(s, 2), "born in the usa", false);
    endTimer(data, s, "timeout");
    expect(s.phase).toBe("CLUE_JUDGING");
    expect(s.submissions[id(s, 1)]).toMatchObject({ auto: "correct", judged: "correct" });
    expect(s.submissions[id(s, 2)].judged).toBeNull();
    expect(() => adminAction(data, s, { kind: "showResults" }, 0)).toThrow(/judging/);
    adminAction(data, s, { kind: "judge", teamId: id(s, 2), verdict: "wrong" }, 0);
    adminAction(data, s, { kind: "showResults" }, 0);
    expect(s.teams.map((t) => t.score)).toEqual([600, 600, 0]);
    adminAction(data, s, { kind: "backToBoard" }, 0);
    expect(s.controlTeamId).toBe(id(s, 1));
    adminAction(data, s, { kind: "undo" }, 0);
    expect(s.teams.map((t) => t.score)).toEqual([0, 0, 0]);
    expect(s.controlTeamId).toBe(id(s, 0));
    // wraps
    s.controlTeamId = id(s, 2);
    adminAction(data, s, { kind: "openClue", cat: 0, idx: 0 }, 0);
    adminAction(data, s, { kind: "closeClue" }, 0);
    expect(s.controlTeamId).toBe(id(s, 0));
  });

  it("undo while still on results returns to judging", () => {
    const s = setup(2);
    adminAction(data, s, { kind: "openClue", cat: 0, idx: 0 }, 0);
    adminAction(data, s, { kind: "startTimer" }, 0);
    teamDraft(data, s, id(s, 0), "nixon", false);
    adminAction(data, s, { kind: "endTimer" }, 0);
    adminAction(data, s, { kind: "showResults" }, 0);
    expect(s.teams[0].score).toBe(200);
    adminAction(data, s, { kind: "undo" }, 0);
    expect(s.phase).toBe("CLUE_JUDGING");
    expect(s.teams[0].score).toBe(0);
  });

  it("daily double: control-only wager, 300 can bet 1000, verbal judged by admin", () => {
    const s = setup(3);
    s.teams[0].score = 300;
    adminAction(data, s, { kind: "openClue", cat: 5, idx: 3 }, 0);
    expect(s.phase).toBe("DD_STING");
    adminAction(data, s, { kind: "ddContinue" }, 0);
    expect(() => teamDdWager(s, id(s, 1), 100)).toThrow(/control/);
    expect(() => teamDdWager(s, id(s, 0), 1001)).toThrow();
    teamDdWager(s, id(s, 0), 1000);
    adminAction(data, s, { kind: "lockDdWager" }, 0);
    adminAction(data, s, { kind: "startTimer" }, 0);
    expect(() => teamDraft(data, s, id(s, 0), "I pledge", false)).toThrow(); // verbal
    const tv = buildView(data, s, { role: "tv" }, new Set());
    expect(tv.currentClue?.answer).toBeUndefined();
    adminAction(data, s, { kind: "ddJudge", verdict: "correct" }, 0);
    expect(s.phase).toBe("DD_RESULT");
    expect(s.teams[0].score).toBe(1300);
    expect(buildView(data, s, { role: "tv" }, new Set()).currentClue?.answer).toMatch(/pledge/i);
    adminAction(data, s, { kind: "backToBoard" }, 0);
    expect(s.controlTeamId).toBe(id(s, 1));
  });

  it("final: 0-score team wagers 0, 90s timer, reveal lowest first, ties share podium (client)", () => {
    const s = setup(3);
    s.teams[0].score = 800; s.teams[1].score = 0; s.teams[2].score = 400;
    adminAction(data, s, { kind: "skipToFinal" }, 0);
    adminAction(data, s, { kind: "openFinalWagers" }, 0);
    expect(() => teamFinalWager(s, id(s, 1), 1)).toThrow();
    teamFinalWager(s, id(s, 1), 0);
    teamFinalWager(s, id(s, 0), 800);
    const tv = buildView(data, s, { role: "tv" }, new Set());
    expect(tv.finalWagers).toEqual({});
    expect(tv.finalWagersLocked.length).toBe(2);
    adminAction(data, s, { kind: "lockFinalWagers" }, 0);
    expect(s.finalWagers[id(s, 2)]).toBe(0);
    adminAction(data, s, { kind: "startTimer" }, 0);
    expect(s.timerEndsAt).toBe(90000);
    teamDraft(data, s, id(s, 0), "Ft. McHenry", false);
    endTimer(data, s, "timeout");
    expect(s.finalOrder).toEqual([id(s, 1), id(s, 2), id(s, 0)]);
    adminAction(data, s, { kind: "finalRevealNext" }, 0);
    adminAction(data, s, { kind: "finalRevealNext" }, 0);
    adminAction(data, s, { kind: "finalRevealNext" }, 0);
    expect(s.teams[0].score).toBe(1600);
    adminAction(data, s, { kind: "showWinners" }, 0);
    expect(s.phase).toBe("PODIUM");
  });

  it("never leaks answers or other teams' text to team/tv", () => {
    const s = setup(2);
    adminAction(data, s, { kind: "openClue", cat: 0, idx: 0 }, 0);
    adminAction(data, s, { kind: "startTimer" }, 0);
    teamDraft(data, s, id(s, 0), "SECRETGUESS", false);
    for (const phase of ["answering", "judging", "reveal"]) {
      if (phase === "judging") adminAction(data, s, { kind: "endTimer" }, 0);
      if (phase === "reveal") adminAction(data, s, { kind: "revealGuesses" }, 0);
      const tvJson = JSON.stringify(buildView(data, s, { role: "tv" }, new Set()));
      const t1Json = JSON.stringify(buildView(data, s, { role: "team", teamId: id(s, 1) }, new Set()));
      for (const j of [tvJson, t1Json]) {
        expect(j).not.toMatch(/Nixon/);
        expect(j).not.toMatch(/SECRETGUESS/);
      }
      expect(JSON.stringify(buildView(data, s, { role: "team", teamId: id(s, 0) }, new Set()))).toMatch(/SECRETGUESS/);
    }
    // board never reveals which tile is the DD to non-admins
    expect(JSON.stringify(buildView(data, s, { role: "tv" }, new Set()))).not.toMatch(/dailyDoubles/);
  });
});
