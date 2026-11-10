import type { PublicTeam, View } from "../../shared/types";

export function roomFromUrl(): string | null {
  const r = new URLSearchParams(location.search).get("room");
  return r && /^[A-Za-z]{4}$/.test(r) ? r.toUpperCase() : null;
}

export function setRoomInUrl(code: string | null) {
  const u = new URL(location.href);
  if (code) u.searchParams.set("room", code); else u.searchParams.delete("room");
  history.replaceState(null, "", u);
}

/** Standard competition ranking (1, 1, 3…). */
export function rankTeams(teams: PublicTeam[]): { team: PublicTeam; place: number }[] {
  const sorted = [...teams].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
  return sorted.map((team) => ({ team, place: 1 + sorted.filter((t) => t.score > team.score).length }));
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const teamById = (v: View, id: string | null | undefined) => v.teams.find((t) => t.id === id);

export const fmtScore = (n: number) => (n < 0 ? `−${Math.abs(n).toLocaleString()}` : n.toLocaleString());

export const PHASE_LABEL: Record<string, string> = {
  LOBBY: "Lobby", CATEGORY_INTRO: "Category intro", BOARD: "Board",
  CLUE_READING: "Reading clue", CLUE_ANSWERING: "Teams answering", CLUE_JUDGING: "Judging",
  CLUE_REVEAL_GUESSES: "Revealing guesses", CLUE_RESULTS: "Results",
  DD_STING: "Daily Double!", DD_WAGER: "DD wager", DD_READING: "DD reading", DD_ANSWERING: "DD answering", DD_RESULT: "DD result",
  FINAL_CATEGORY: "Final category", FINAL_WAGER: "Final wagers", FINAL_READING: "Final reading",
  FINAL_ANSWERING: "Final answering", FINAL_REVEAL: "Final reveal", PODIUM: "Podium",
};
