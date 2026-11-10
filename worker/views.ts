// Builds the per-role view of the game. This is the ONLY place state leaves
// the server, so it is responsible for hiding answers, other teams'
// submissions and wagers from anyone who shouldn't see them yet.

import { autoMark } from "../shared/match";
import type { GameData, Phase, PublicTeam, View, ViewClue, ViewSubmission } from "../shared/types";
import { clueKey, ddMax, finalMax, getClueSpec, sortedTeams, type GameState } from "./game";

export type Viewer = { role: "admin" } | { role: "tv" } | { role: "team"; teamId: string } | { role: "guest" };

const ANSWERING: Phase[] = ["CLUE_ANSWERING", "DD_ANSWERING", "FINAL_ANSWERING"];

export function buildView(data: GameData, s: GameState, v: Viewer, connectedTeams: Set<string>): View {
  const isAdmin = v.role === "admin";
  const myId = v.role === "team" ? v.teamId : null;
  const teams: PublicTeam[] = sortedTeams(s).map((t) => ({
    id: t.id, name: t.name, icon: t.icon, members: t.members, score: t.score, joinOrder: t.joinOrder,
    connected: connectedTeams.has(t.id),
  }));

  // ----- current clue -----
  let currentClue: ViewClue | null = null;
  const spec = getClueSpec(data, s);
  if (spec && s.currentClue) {
    const isFinal = s.currentClue.cat === -1;
    // Hide the clue text until it is actually read (DD sting/wager, Final category/wager).
    const hideText = ["DD_STING", "DD_WAGER", "FINAL_CATEGORY", "FINAL_WAGER"].includes(s.phase);
    const allFinalRevealed = s.phase === "FINAL_REVEAL" && s.finalRevealIndex >= s.finalOrder.length && s.finalOrder.length > 0;
    const answerPublic = s.phase === "CLUE_RESULTS" || s.phase === "DD_RESULT" || allFinalRevealed || s.phase === "PODIUM";
    currentClue = {
      cat: s.currentClue.cat,
      idx: s.currentClue.idx,
      category: spec.category,
      value: spec.value,
      clue: hideText && !isAdmin ? "" : spec.clue,
      image: hideText && !isAdmin ? undefined : spec.image,
      dailyDouble: !!spec.dailyDouble,
      verbal: !!spec.verbal,
      ...(isAdmin || answerPublic ? { answer: spec.answer } : {}),
    };
  }

  // ----- submissions -----
  const order = teams.map((t) => t.id);
  let submissions: ViewSubmission[] = [];
  const submittedFlag = (id: string) => !!s.submitted[id] || (!!s.submissions[id] && s.submissions[id].text.length > 0);

  if (isAdmin) {
    submissions = order.map((id) => {
      const sub = s.submissions[id];
      if (sub) return { teamId: id, submitted: submittedFlag(id), text: sub.text, auto: sub.auto, judged: sub.judged, closeMatch: sub.closeMatch };
      const draft = s.drafts[id] ?? "";
      const live = spec && !spec.verbal && draft.trim() ? autoMark(draft, spec) : null;
      return { teamId: id, submitted: !!s.submitted[id], text: draft, auto: live?.auto, judged: null, closeMatch: live?.closeMatch };
    });
  } else {
    const p = s.phase;
    const publicFor = (id: string): ViewSubmission => {
      const sub = s.submissions[id];
      return { teamId: id, submitted: submittedFlag(id), text: sub?.text ?? "", judged: sub?.judged ?? null };
    };
    if (p === "CLUE_REVEAL_GUESSES") {
      submissions = order.map((id, i) => i < s.revealIndex ? { ...publicFor(id), judged: null } : { teamId: id, submitted: submittedFlag(id) });
    } else if (p === "CLUE_RESULTS") {
      submissions = order.map(publicFor);
    } else if (p === "DD_RESULT" && s.controlTeamId) {
      submissions = [publicFor(s.controlTeamId)];
    } else if (p === "FINAL_REVEAL" || p === "PODIUM") {
      submissions = order.map((id) => s.finalResults[id] ? publicFor(id) : { teamId: id, submitted: submittedFlag(id) });
    } else if (ANSWERING.includes(p) || p === "CLUE_JUDGING") {
      submissions = order.map((id) => ({ teamId: id, submitted: submittedFlag(id) }));
    }
    // A team always sees its own text; judgment only once it's public.
    if (myId) {
      submissions = submissions.map((x) => x.teamId === myId ? { ...x, text: s.submissions[myId]?.text ?? s.drafts[myId] ?? "" } : x);
    }
  }

  // ----- wagers -----
  const finalWagers: Record<string, number> = {};
  for (const [id, w] of Object.entries(s.finalWagers)) {
    if (isAdmin || id === myId || s.finalResults[id]) finalWagers[id] = w;
  }
  const finalWagersLocked = s.phase === "FINAL_WAGER" ? Object.keys(s.finalWagers) : [];
  const controlScore = s.teams.find((t) => t.id === s.controlTeamId)?.score ?? 0;
  const seesDdDraft = isAdmin || (myId != null && myId === s.controlTeamId);

  const me = myId && s.teams.some((t) => t.id === myId)
    ? {
        teamId: myId,
        draft: s.drafts[myId] ?? "",
        submitted: !!s.submitted[myId],
        finalWager: s.finalWagers[myId] ?? null,
        finalMax: finalMax(s.teams.find((t) => t.id === myId)!.score),
      }
    : null;

  return {
    role: v.role,
    roomCode: s.roomCode,
    title: data.title,
    phase: s.phase,
    teams,
    controlTeamId: s.controlTeamId,
    board: data.categories.map((c) => ({
      name: c.name,
      values: c.clues.map((x) => x.value),
      ...(isAdmin ? { dailyDoubles: c.clues.map((x) => !!x.dailyDouble) } : {}),
    })),
    usedClues: s.usedClues,
    categoryIntroIndex: s.categoryIntroIndex,
    currentClue,
    timerEndsAt: s.timerEndsAt,
    timerDuration: s.timerDuration,
    timerEndSeq: s.timerEndSeq,
    timerEndReason: s.timerEndReason,
    submissions,
    revealIndex: s.revealIndex,
    ddWager: s.ddWager,
    ddWagerDraft: seesDdDraft ? s.ddWagerDraft : null,
    ddMax: s.phase.startsWith("DD_") ? ddMax(controlScore) : null,
    finalCategory: data.final.category,
    finalWagersLocked,
    finalWagers,
    finalOrder: s.finalOrder,
    finalRevealIndex: s.finalRevealIndex,
    finalResults: s.finalResults,
    muted: s.muted,
    undoCount: isAdmin ? s.undoStack.length : 0,
    me,
  };
}

export { clueKey };
