import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminAction, ServerMsg, View, ViewSubmission } from "../../shared/types";
import { ConnBadge } from "../components/ConnBadge";
import { TimerBar } from "../components/TimerBar";
import { useToast } from "../components/Toast";
import { useRoom } from "../lib/socket";
import { PHASE_LABEL, fmtScore, ordinal, rankTeams, roomFromUrl, setRoomInUrl, teamById } from "../lib/util";

const TOKEN_KEY = "jeopardy:adminToken";

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [room, setRoom] = useState<string | null>(roomFromUrl());
  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); }, []);
  const pickRoom = (c: string | null) => { setRoomInUrl(c); setRoom(c); };

  if (!token) return <Login onToken={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); }} />;
  if (!room) return <Home token={token} onRoom={pickRoom} onAuthFail={logout} />;
  return <Console token={token} room={room} onLeave={() => pickRoom(null)} onAuthFail={logout} />;
}

function Page({ children }: { children: ReactNode }) {
  return <div className="min-h-full stars-bg flex flex-col">{children}</div>;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Page>
      <form className="flex-1 flex flex-col justify-center gap-4 p-6 max-w-sm mx-auto w-full"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr("");
          const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) })
            .then((r) => r.json()).catch(() => ({ error: "Network error" }));
          setBusy(false);
          if (r.token) onToken(r.token); else setErr(r.error ?? "Login failed");
        }}>
        <h1 className="font-display text-5xl text-center">Host login</h1>
        <input className="input text-center font-display text-5xl tracking-[0.4em]" type="password" inputMode="numeric" autoFocus
          value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
        {err && <div className="text-gold text-center">{err}</div>}
        <button className="btn-red text-xl py-4" disabled={busy || !pin}>Log in</button>
      </form>
    </Page>
  );
}

function Home({ token, onRoom, onAuthFail }: { token: string; onRoom: (c: string) => void; onAuthFail: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const create = async () => {
    setErr("");
    const r = await fetch("/api/rooms", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401) return onAuthFail();
    const j = await r.json().catch(() => ({}));
    if (j.code) onRoom(j.code); else setErr(j.error ?? "Could not create a game");
  };
  const resume = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const r = await fetch(`/api/rooms/${code}`).then((r) => r.json()).catch(() => ({ exists: false }));
    if (r.exists) onRoom(code.toUpperCase()); else setErr(`No game with code ${code}`);
  };
  return (
    <Page>
      <div className="flex-1 flex flex-col justify-center gap-6 p-6 max-w-sm mx-auto w-full">
        <h1 className="font-display text-5xl text-center">🎆 Host console</h1>
        <button className="btn-red text-2xl py-5" onClick={create}>Create Game</button>
        <form onSubmit={resume} className="flex flex-col gap-2">
          <label className="text-cream font-semibold">Resume game</label>
          <div className="flex gap-2">
            <input className="input text-center font-display text-3xl tracking-[0.3em] uppercase" value={code} placeholder="CODE"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))} />
            <button className="btn-white px-6" disabled={code.length !== 4}>Go</button>
          </div>
        </form>
        {err && <div className="text-gold text-center">{err}</div>}
        <button className="text-sm text-cream/60 underline" onClick={onAuthFail}>Log out</button>
      </div>
    </Page>
  );
}

// ======================= Console =======================

type Act = (a: AdminAction) => void;

function Console({ token, room, onLeave, onAuthFail }: { token: string; room: string; onLeave: () => void; onAuthFail: () => void }) {
  const toast = useToast();
  const onMessage = useCallback((m: ServerMsg) => {
    if (m.type === "authFailed") onAuthFail();
    else if (m.type === "error") toast.show(m.message);
  }, [onAuthFail, toast.show]);
  const { view, status, send, serverNow } = useRoom(room, () => ({ type: "hello", role: "admin", token }), onMessage);
  const act: Act = useCallback((action) => { if (!send({ type: "admin", action })) toast.show("Not connected — retrying…"); }, [send, toast.show]);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<null | "scores" | "control" | "teams">(null);

  if (status === "notfound") {
    return <Page><div className="flex-1 flex flex-col items-center justify-center gap-4"><div>Room {room} not found.</div><button className="btn-white" onClick={onLeave}>Back</button></div></Page>;
  }
  if (!view || view.role !== "admin") return <Page><div className="flex-1 flex items-center justify-center">Connecting…</div></Page>;

  const primary = primaryAction(view);
  const tvUrl = `${location.origin}/tv?room=${view.roomCode}`;

  return (
    <Page>
      <ConnBadge status={status} />
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-navy-dark/95 border-b-4 border-flag px-4 py-2" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <div className="font-display text-3xl tracking-widest">{view.roomCode}</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-cream/70">Phase</div>
          <div className="font-bold truncate">{PHASE_LABEL[view.phase]}</div>
        </div>
        <button className="btn-ghost py-2" onClick={() => act({ kind: "setMuted", muted: !view.muted })}>{view.muted ? "🔇" : "🔊"}</button>
        <button className="btn-ghost py-2" onClick={() => setMenu(true)}>☰</button>
      </header>

      <main className="flex-1 p-4 pb-40 flex flex-col gap-4 max-w-xl mx-auto w-full">
        <PhaseBody view={view} act={act} serverNow={serverNow} tvUrl={tvUrl} openModal={setModal} />
      </main>

      <div className="fixed bottom-0 inset-x-0 z-20 bg-navy-dark/95 border-t border-white/10 px-4 pt-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="max-w-xl mx-auto">
          {primary ? (
            <button className={`w-full ${primary.style ?? "btn-red"} text-2xl py-5 shadow-2xl`} disabled={primary.disabled}
              onClick={() => { if (!primary.confirm || window.confirm(primary.confirm)) act(primary.action); }}>
              {primary.label}
            </button>
          ) : (
            <div className="w-full text-center text-cream/70 py-5">{hintFor(view)}</div>
          )}
        </div>
      </div>

      {menu && <Menu view={view} act={act} tvUrl={tvUrl} close={() => setMenu(false)} openModal={(m) => { setMenu(false); setModal(m); }} onLeave={onLeave} />}
      {modal === "scores" && <EditScores view={view} act={act} close={() => setModal(null)} />}
      {modal === "control" && <PassControl view={view} act={act} close={() => setModal(null)} />}
      {modal === "teams" && <ManageTeams view={view} act={act} close={() => setModal(null)} />}
      {toast.node}
    </Page>
  );
}

type Primary = { label: string; action: AdminAction; disabled?: boolean; confirm?: string; style?: string } | null;

function primaryAction(v: View): Primary {
  const unjudged = v.submissions.filter((s) => s.judged == null).length;
  switch (v.phase) {
    case "LOBBY": return { label: v.teams.length ? `Start Game (${v.teams.length} team${v.teams.length > 1 ? "s" : ""})` : "Waiting for teams…", action: { kind: "startGame" }, disabled: !v.teams.length };
    case "CATEGORY_INTRO": return v.categoryIntroIndex < v.board.length - 1
      ? { label: `Next Category (${v.categoryIntroIndex + 2}/${v.board.length})`, action: { kind: "nextIntro" } }
      : { label: "Show Board", action: { kind: "nextIntro" } };
    case "CLUE_READING": case "DD_READING": case "FINAL_READING": return { label: "▶ Start Timer", action: { kind: "startTimer" } };
    case "CLUE_ANSWERING": case "FINAL_ANSWERING": return { label: "⏹ End Timer Early", action: { kind: "endTimer" }, style: "btn-white" };
    case "CLUE_JUDGING": return { label: "Reveal Guesses", action: { kind: "revealGuesses" } };
    case "CLUE_REVEAL_GUESSES": return v.revealIndex < v.teams.length
      ? { label: `Next Guess (${v.revealIndex + 1}/${v.teams.length})`, action: { kind: "nextGuess" } }
      : { label: unjudged ? `Judge ${unjudged} more to show results` : "Show Results", action: { kind: "showResults" }, disabled: unjudged > 0 };
    case "CLUE_RESULTS": case "DD_RESULT": return { label: "Back to Board", action: { kind: "backToBoard" } };
    case "DD_STING": return { label: "Continue to Wager", action: { kind: "ddContinue" } };
    case "DD_WAGER": return { label: v.ddWagerDraft != null ? `Lock Wager (${v.ddWagerDraft})` : "Waiting for wager…", action: { kind: "lockDdWager" }, disabled: v.ddWagerDraft == null };
    case "DD_ANSWERING": return v.timerEndsAt != null ? { label: "⏹ End Timer", action: { kind: "endTimer" }, style: "btn-white" } : null;
    case "FINAL_CATEGORY": return { label: "Open Wagers", action: { kind: "openFinalWagers" } };
    case "FINAL_WAGER": {
      const missing = v.teams.filter((t) => !(t.id in v.finalWagers)).map((t) => t.name);
      return { label: `Lock Wagers (${v.teams.length - missing.length}/${v.teams.length})`, action: { kind: "lockFinalWagers" },
        confirm: missing.length ? `${missing.join(", ")} haven't wagered — they'll wager 0. Lock anyway?` : undefined };
    }
    case "FINAL_REVEAL": {
      const nextId = v.finalOrder[v.finalRevealIndex];
      if (!nextId) return { label: "🏆 Show Winners", action: { kind: "showWinners" }, style: "btn-gold" };
      const t = teamById(v, nextId);
      const judged = v.submissions.find((s) => s.teamId === nextId)?.judged != null;
      return { label: judged ? `Reveal ${t?.icon} ${t?.name} (${v.finalRevealIndex + 1}/${v.finalOrder.length})` : `Judge ${t?.name} first`, action: { kind: "finalRevealNext" }, disabled: !judged };
    }
    default: return null;
  }
}

function hintFor(v: View) {
  if (v.phase === "BOARD") return "Tap the clue the team in control picks ↑";
  if (v.phase === "DD_ANSWERING") return "Mark the answer ✅ or ❌ above";
  if (v.phase === "PODIUM") return "🎉 Game over! Reset from the menu to play again.";
  return "";
}

// ---------------- Phase bodies ----------------

function PhaseBody({ view: v, act, serverNow, tvUrl, openModal }: { view: View; act: Act; serverNow: () => number; tvUrl: string; openModal: (m: "scores" | "control" | "teams") => void }) {
  const p = v.phase;
  const ctl = teamById(v, v.controlTeamId);

  if (p === "LOBBY") {
    return (
      <>
        <Card>
          <div className="text-sm text-cream/70">TV link (open on the laptop)</div>
          <a className="font-semibold break-all underline" href={tvUrl} target="_blank" rel="noreferrer">{tvUrl}</a>
          <button className="btn-ghost mt-2 w-full" onClick={() => navigator.clipboard?.writeText(tvUrl)}>Copy TV link</button>
        </Card>
        <TeamList view={v} act={act} />
      </>
    );
  }
  if (p === "CATEGORY_INTRO") {
    return <Card><div className="text-sm text-cream/70">On the TV: category {v.categoryIntroIndex + 1} of {v.board.length}</div><div className="font-display text-4xl">{v.board[v.categoryIntroIndex]?.name}</div></Card>;
  }
  if (p === "BOARD") {
    return (
      <>
        <ControlLine view={v} />
        <AdminBoard view={v} act={act} />
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" disabled={!v.undoCount} onClick={() => act({ kind: "undo" })}>↶ Undo ({v.undoCount})</button>
          <button className="btn-ghost" onClick={() => openModal("scores")}>Edit Scores</button>
          <button className="btn-ghost" onClick={() => openModal("control")}>Pass Control</button>
          <button className="btn-ghost" onClick={() => window.confirm("Skip the rest of the board and go to Final Jeopardy?") && act({ kind: "skipToFinal" })}>Skip to Final</button>
        </div>
        <Scores view={v} />
      </>
    );
  }
  if (p === "PODIUM") {
    return (
      <Card>
        <div className="font-display text-3xl mb-2">Final standings</div>
        {rankTeams(v.teams).map(({ team, place }) => (
          <div key={team.id} className="flex gap-3 text-lg py-1"><b className="w-10 text-gold">{ordinal(place)}</b><span>{team.icon} {team.name}</span><span className="ml-auto font-display text-2xl">{fmtScore(team.score)}</span></div>
        ))}
      </Card>
    );
  }
  if (p === "FINAL_CATEGORY" || p === "FINAL_WAGER") {
    return (
      <>
        <Card><div className="text-sm text-cream/70">Final Jeopardy category</div><div className="font-display text-4xl">{v.finalCategory}</div></Card>
        {p === "FINAL_WAGER" && (
          <Card>
            <div className="font-semibold mb-2">Wagers</div>
            {v.teams.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1">
                <span>{t.icon} {t.name}</span><span className="text-cream/60 text-sm">({fmtScore(t.score)})</span>
                <span className="ml-auto font-display text-2xl">{t.id in v.finalWagers ? `✅ ${v.finalWagers[t.id]}` : "⏳"}</span>
              </div>
            ))}
          </Card>
        )}
        <ClueCard view={v} />
      </>
    );
  }

  // Everything below is about the current clue.
  const c = v.currentClue;
  if (!c) return null;
  const isDd = p.startsWith("DD_");

  return (
    <>
      {isDd && <ControlLine view={v} />}
      {p === "DD_STING" && <Card className="bg-flag/40"><div className="font-display text-5xl text-gold text-center">Daily Double!</div></Card>}
      {p === "DD_WAGER" && <DdWagerCard view={v} act={act} />}
      {p !== "DD_WAGER" && p !== "DD_STING" && v.ddWager != null && isDd && <div className="text-center text-xl">Wager: <b className="font-display text-3xl text-gold">{v.ddWager}</b></div>}
      {v.timerEndsAt != null && <Card><TimerBar endsAt={v.timerEndsAt} duration={v.timerDuration} serverNow={serverNow} /></Card>}
      {(p === "DD_READING" || p === "DD_ANSWERING") && (
        <div className="grid grid-cols-2 gap-3">
          <button className="btn bg-good text-white text-2xl py-5" onClick={() => act({ kind: "ddJudge", verdict: "correct" })}>✅ Correct</button>
          <button className="btn bg-bad text-white text-2xl py-5" onClick={() => act({ kind: "ddJudge", verdict: "wrong" })}>❌ Wrong</button>
        </div>
      )}
      <ClueCard view={v} big={isDd && !!c.verbal} />
      {["CLUE_ANSWERING", "CLUE_JUDGING", "CLUE_REVEAL_GUESSES", "CLUE_RESULTS", "FINAL_ANSWERING", "FINAL_REVEAL", "DD_ANSWERING", "DD_RESULT"].includes(p) && !(isDd && c.verbal) && (
        <Submissions view={v} act={act} />
      )}
      {p === "CLUE_RESULTS" && <Scores view={v} />}
      {p === "DD_RESULT" && <Scores view={v} />}
      {!isDd && ctl && p !== "FINAL_REVEAL" && !p.startsWith("FINAL") && <ControlLine view={v} />}
    </>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white/10 p-4 ${className}`}>{children}</div>;
}

function ControlLine({ view }: { view: View }) {
  const t = teamById(view, view.controlTeamId);
  return <div className="rounded-xl bg-gold text-navy px-4 py-2 font-bold">🎯 In control: {t ? `${t.icon} ${t.name}` : "—"}</div>;
}

function Scores({ view }: { view: View }) {
  return (
    <Card>
      {view.teams.map((t) => (
        <div key={t.id} className="flex items-center gap-2 py-0.5">
          <span>{t.icon}</span><span className={`truncate ${t.connected ? "" : "opacity-50"}`}>{t.name}{t.connected ? "" : " (offline)"}</span>
          <span className="ml-auto font-display text-2xl">{fmtScore(t.score)}</span>
        </div>
      ))}
    </Card>
  );
}

function AdminBoard({ view, act }: { view: View; act: Act }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {view.board.map((c, ci) => (
        <div key={ci} className="tile rounded-md h-14 flex items-center justify-center text-center p-0.5">
          <span className="text-[10px] leading-tight font-bold">{c.name}</span>
        </div>
      ))}
      {[0, 1, 2, 3, 4].map((i) => view.board.map((c, ci) => {
        const used = view.usedClues.includes(`${ci}-${i}`);
        const dd = c.dailyDoubles?.[i];
        return (
          <button key={`${ci}-${i}`} disabled={used}
            className={`rounded-md h-14 font-display text-2xl relative ${used ? "bg-navy-dark/60 text-white/20" : "tile text-gold active:scale-95"}`}
            onClick={() => act({ kind: "openClue", cat: ci, idx: i })}>
            {c.values[i]}
            {dd && !used && <span className="absolute top-0 right-1 text-[10px] text-white">★DD</span>}
          </button>
        );
      }))}
    </div>
  );
}

function ClueCard({ view, big = false }: { view: View; big?: boolean }) {
  const c = view.currentClue;
  if (!c) return null;
  return (
    <Card>
      <div className="text-sm text-gold font-bold">{c.cat === -1 ? "FINAL" : c.category} {c.cat !== -1 && `· ${c.value}`} {c.dailyDouble && "· DAILY DOUBLE"} {c.verbal && "· 🎤 VERBAL"}</div>
      <div className="text-lg mt-1">{c.clue}</div>
      {c.image && <img src={c.image} alt="" className="mt-2 max-h-32 rounded-lg object-contain" />}
      <div className="mt-3 rounded-xl bg-white text-navy p-3">
        <div className="text-xs font-bold uppercase text-flag">Answer</div>
        <div className={big ? "text-2xl leading-relaxed font-semibold" : "text-2xl font-bold"}>{c.answer}</div>
      </div>
    </Card>
  );
}

function DdWagerCard({ view, act }: { view: View; act: Act }) {
  const [val, setVal] = useState("");
  const max = view.ddMax ?? 1000;
  return (
    <Card>
      <div className="text-sm text-cream/70">Team's wager (0 – {max})</div>
      <div className="font-display text-5xl text-gold">{view.ddWagerDraft ?? "…"}</div>
      <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); if (val !== "") { act({ kind: "setDdWager", amount: Number(val) }); setVal(""); } }}>
        <input className="input" inputMode="numeric" placeholder="Override wager" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))} />
        <button className="btn-white">Set</button>
      </form>
    </Card>
  );
}

function Submissions({ view, act }: { view: View; act: Act }) {
  const p = view.phase;
  const canJudge = p === "CLUE_JUDGING" || p === "CLUE_REVEAL_GUESSES" || p === "FINAL_REVEAL";
  const live = p.endsWith("ANSWERING");
  const ids = p === "FINAL_REVEAL" ? view.finalOrder : p.startsWith("DD_") ? [view.controlTeamId!] : view.teams.map((t) => t.id);
  return (
    <Card>
      <div className="flex items-center mb-2">
        <div className="font-semibold">{live ? "Live answers" : p === "FINAL_REVEAL" ? "Reveal order (lowest first)" : "Answers"}</div>
        {p === "CLUE_REVEAL_GUESSES" && <div className="ml-auto text-sm text-cream/70">Shown on TV: {view.revealIndex}/{view.teams.length}</div>}
      </div>
      <div className="flex flex-col gap-2">
        {ids.map((id, i) => {
          const t = teamById(view, id);
          const s = view.submissions.find((x) => x.teamId === id);
          if (!t) return null;
          const revealed = p === "FINAL_REVEAL" ? !!view.finalResults[id] : p === "CLUE_REVEAL_GUESSES" ? i < view.revealIndex : false;
          return (
            <SubmissionRow key={id} team={t} sub={s} live={live} revealed={revealed}
              canJudge={canJudge && !(p === "FINAL_REVEAL" && revealed)}
              wager={p === "FINAL_REVEAL" ? view.finalWagers[id] : undefined}
              result={p === "FINAL_REVEAL" ? view.finalResults[id] : undefined}
              onJudge={(verdict) => act({ kind: "judge", teamId: id, verdict })} />
          );
        })}
      </div>
    </Card>
  );
}

function SubmissionRow({ team, sub, live, revealed, canJudge, wager, result, onJudge }: {
  team: { icon: string; name: string }; sub?: ViewSubmission; live: boolean; revealed: boolean; canJudge: boolean;
  wager?: number; result?: { after: number; correct: boolean }; onJudge: (v: "correct" | "wrong") => void;
}) {
  const judged = sub?.judged;
  const border = judged === "correct" ? "border-good bg-good/20" : judged === "wrong" ? "border-bad bg-bad/20" : sub?.auto === "correct" ? "border-good/60" : "border-white/20";
  const text = sub?.text ?? "";
  return (
    <div className={`rounded-xl border-2 p-3 ${border}`}>
      <div className="flex items-center gap-2 text-sm">
        <span>{team.icon}</span><b className="truncate">{team.name}</b>
        {live && sub?.submitted && <span className="text-good">✅ submitted</span>}
        {live && !sub?.submitted && text && <span className="text-cream/60">typing…</span>}
        {sub?.auto === "correct" && <span className="ml-auto text-good font-bold">AUTO ✓</span>}
        {sub?.auto !== "correct" && sub?.closeMatch && <span className="ml-auto">🤏 close</span>}
        {revealed && <span className="text-gold">📺</span>}
        {wager != null && <span className="text-cream/70">wager {wager}</span>}
      </div>
      <div className={`text-xl font-semibold break-words ${text ? "" : "italic text-white/40"}`}>{text || (live ? "…" : "(blank)")}</div>
      {result && <div className="text-sm">{result.correct ? "✅" : "❌"} → {fmtScore(result.after)}</div>}
      {canJudge && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button className={`btn py-2 ${judged === "correct" ? "bg-good text-white" : "bg-white/10"}`} onClick={() => onJudge("correct")}>✅</button>
          <button className={`btn py-2 ${judged === "wrong" ? "bg-bad text-white" : "bg-white/10"}`} onClick={() => onJudge("wrong")}>❌</button>
        </div>
      )}
    </div>
  );
}

function TeamList({ view, act }: { view: View; act: Act }) {
  return (
    <Card>
      <div className="font-semibold mb-2">Teams ({view.teams.length}/7)</div>
      {view.teams.length === 0 && <div className="text-cream/60">No teams yet — show the TV so people can scan the QR code.</div>}
      {view.teams.map((t) => <TeamRow key={t.id} team={t} act={act} />)}
    </Card>
  );
}

function TeamRow({ team: t, act }: { team: View["teams"][number]; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  return (
    <div className="py-2 border-b border-white/10 last:border-0">
      {editing ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ kind: "renameTeam", teamId: t.id, name }); setEditing(false); }}>
          <input className="input py-2" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button className="btn-white py-2">Save</button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-2xl">{t.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate">{t.name} {!t.connected && <span className="text-xs text-cream/50">(offline)</span>}</div>
            <div className="text-xs text-cream/70 truncate">{t.members.join(", ")}</div>
          </div>
          <button className="btn-ghost py-1 px-3 text-sm" onClick={() => { setName(t.name); setEditing(true); }}>Rename</button>
          <button className="btn-ghost py-1 px-3 text-sm text-gold" onClick={() => window.confirm(`Remove ${t.name}?`) && act({ kind: "removeTeam", teamId: t.id })}>Remove</button>
        </div>
      )}
    </div>
  );
}

// ---------------- Menu & modals ----------------

function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-end justify-center" onClick={close}>
      <div ref={ref} tabIndex={-1} className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-t-3xl bg-navy border-t-4 border-flag p-5 pb-10 outline-none"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-4">
          <div className="font-display text-3xl">{title}</div>
          <button className="ml-auto btn-ghost py-1" onClick={close}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Menu({ view: v, act, tvUrl, close, openModal, onLeave }: { view: View; act: Act; tvUrl: string; close: () => void; openModal: (m: "scores" | "control" | "teams") => void; onLeave: () => void }) {
  const inClue = v.phase.startsWith("CLUE_") || v.phase.startsWith("DD_");
  const run = (a: AdminAction, confirmMsg?: string) => { if (!confirmMsg || window.confirm(confirmMsg)) { act(a); close(); } };
  return (
    <Sheet title="Host menu" close={close}>
      <div className="grid grid-cols-1 gap-2">
        <button className="btn-white" disabled={!v.undoCount} onClick={() => run({ kind: "undo" })}>↶ Undo last scoring action ({v.undoCount})</button>
        <button className="btn-ghost" onClick={() => openModal("scores")}>Edit Scores</button>
        <button className="btn-ghost" onClick={() => openModal("control")}>Pass Control</button>
        <button className="btn-ghost" disabled={!inClue} onClick={() => run({ kind: "closeClue" }, "Close this clue without scoring? Control still rotates.")}>Close Clue Without Scoring</button>
        <button className="btn-ghost" disabled={v.phase !== "BOARD" && v.phase !== "CATEGORY_INTRO"} onClick={() => run({ kind: "skipToFinal" }, "Skip to Final Jeopardy?")}>Skip to Final</button>
        <button className="btn-ghost" onClick={() => openModal("teams")}>Rename / Remove Teams</button>
        <button className="btn-ghost" onClick={() => run({ kind: "setMuted", muted: !v.muted })}>{v.muted ? "🔊 Unmute TV" : "🔇 Mute TV"}</button>
        <a className="btn-ghost text-center" href={tvUrl} target="_blank" rel="noreferrer">Open TV view ↗</a>
        <button className="btn-red mt-4" onClick={() => run({ kind: "resetGame" }, "Reset the game? Everyone goes back to the lobby with 0 points. Teams are kept.")}>Reset Game</button>
        <button className="btn-ghost" onClick={() => { close(); onLeave(); }}>Leave this room</button>
      </div>
    </Sheet>
  );
}

function EditScores({ view, act, close }: { view: View; act: Act; close: () => void }) {
  return (
    <Sheet title="Edit scores" close={close}>
      {view.teams.map((t) => <ScoreRow key={t.id} team={t} act={act} />)}
    </Sheet>
  );
}

function ScoreRow({ team: t, act }: { team: View["teams"][number]; act: Act }) {
  const [val, setVal] = useState(String(t.score));
  useEffect(() => setVal(String(t.score)), [t.score]);
  const n = Number(val);
  return (
    <form className="flex items-center gap-2 py-2" onSubmit={(e) => { e.preventDefault(); if (Number.isInteger(n)) act({ kind: "setScore", teamId: t.id, score: n }); }}>
      <span className="text-2xl">{t.icon}</span>
      <span className="flex-1 truncate">{t.name}</span>
      <input className="input w-28 py-2 text-center" inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9-]/g, ""))} />
      <button className="btn-white py-2" disabled={!Number.isInteger(n) || n === t.score}>Set</button>
    </form>
  );
}

function PassControl({ view, act, close }: { view: View; act: Act; close: () => void }) {
  return (
    <Sheet title="Pass control" close={close}>
      <div className="grid gap-2">
        {view.teams.map((t) => (
          <button key={t.id} className={`btn text-left text-xl ${t.id === view.controlTeamId ? "bg-gold text-navy" : "bg-white/10"}`}
            onClick={() => { act({ kind: "passControl", teamId: t.id }); close(); }}>
            {t.icon} {t.name} {t.id === view.controlTeamId && "🎯"}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function ManageTeams({ view, act, close }: { view: View; act: Act; close: () => void }) {
  return (
    <Sheet title="Teams" close={close}>
      {view.teams.map((t) => <TeamRow key={t.id} team={t} act={act} />)}
    </Sheet>
  );
}
