import QRCode from "qrcode";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Phase, PublicTeam, View, ViewSubmission } from "../../shared/types";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { ConnBadge } from "../components/ConnBadge";
import { TimerBar } from "../components/TimerBar";
import { audio } from "../lib/audio";
import { confettiBurst, fireworks, podiumCelebration } from "../lib/fx";
import { useRoom } from "../lib/socket";
import { fmtScore, ordinal, rankTeams, roomFromUrl, setRoomInUrl, teamById } from "../lib/util";

const ANSWERING: Phase[] = ["CLUE_ANSWERING", "DD_ANSWERING", "FINAL_ANSWERING"];
const CLUE_SCREENS: Phase[] = ["CLUE_READING", "CLUE_ANSWERING", "CLUE_JUDGING", "DD_READING", "DD_ANSWERING", "FINAL_READING", "FINAL_ANSWERING"];

export default function Tv() {
  const [started, setStarted] = useState(false);
  const [room, setRoom] = useState<string | null>(roomFromUrl());

  if (!started) {
    return (
      <Stage>
        <button
          className="absolute inset-0 flex flex-col items-center justify-center gap-10 stars-bg cursor-pointer"
          onClick={async () => {
            await audio.unlock();
            document.documentElement.requestFullscreen?.().catch(() => {});
            setStarted(true);
          }}
        >
          <div className="font-display text-[120px] leading-none text-shadow">July 4th in November</div>
          <div className="rounded-3xl bg-flag px-16 py-8 font-display text-[96px] leading-none shadow-2xl anim-glow">
            Click to start the show 🔊
          </div>
        </button>
      </Stage>
    );
  }
  if (!room) return <Stage><TvCodeEntry onRoom={(c) => { setRoomInUrl(c); setRoom(c); }} /></Stage>;
  return <TvRoom room={room} onBadRoom={() => { setRoomInUrl(null); setRoom(null); }} />;
}

function TvCodeEntry({ onRoom }: { onRoom: (c: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form className="absolute inset-0 flex flex-col items-center justify-center gap-10 stars-bg"
      onSubmit={(e) => { e.preventDefault(); if (/^[A-Za-z]{4}$/.test(code)) onRoom(code.toUpperCase()); }}>
      <div className="font-display text-[96px]">Enter room code</div>
      <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
        className="w-[600px] rounded-3xl bg-white text-navy text-center font-display text-[140px] tracking-[0.3em] outline-none" />
      <button className="btn-red text-5xl px-12 py-6">Show</button>
    </form>
  );
}

/** Fixed 1920×1080 canvas scaled to fit the window. */
function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="fixed inset-0 bg-navy-dark overflow-hidden">
      <div className="absolute left-1/2 top-1/2 overflow-hidden"
        style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function useTvAudio(view: View | null) {
  const lastSeq = useRef<number | null>(null);
  const lastPhase = useRef<Phase | null>(null);

  useEffect(() => { if (view) audio.setMuted(view.muted); }, [view?.muted]);

  const thinking = !!view && view.timerEndsAt != null && ANSWERING.includes(view.phase);
  useEffect(() => {
    if (thinking) void audio.startThink();
    else audio.stopThink();
  }, [thinking, view?.timerEndsAt]);
  useEffect(() => () => audio.stopThink(), []);

  useEffect(() => {
    if (!view) return;
    if (lastSeq.current != null && view.timerEndSeq > lastSeq.current && view.timerEndReason !== "judged") audio.buzzer();
    lastSeq.current = view.timerEndSeq;
  }, [view?.timerEndSeq]);

  useEffect(() => {
    if (!view) return;
    if (view.phase === "DD_STING" && lastPhase.current !== "DD_STING") {
      audio.sting();
      setTimeout(() => fireworks(1800), 400);
    }
    lastPhase.current = view.phase;
  }, [view?.phase]);
}

function TvRoom({ room, onBadRoom }: { room: string; onBadRoom: () => void }) {
  const { view, status, serverNow } = useRoom(room, () => ({ type: "hello", role: "tv" }));
  useTvAudio(view);

  useEffect(() => {
    if (status === "notfound") { const t = setTimeout(onBadRoom, 2500); return () => clearTimeout(t); }
  }, [status, onBadRoom]);

  if (!view) {
    return (
      <Stage>
        <div className="absolute inset-0 stars-bg flex items-center justify-center font-display text-[80px]">
          {status === "notfound" ? `Room ${room} not found` : "Connecting…"}
        </div>
      </Stage>
    );
  }

  const p = view.phase;
  const showScoreboard = !["LOBBY", "CATEGORY_INTRO", "PODIUM"].includes(p);
  let main: ReactNode;
  if (p === "LOBBY") main = <Lobby view={view} />;
  else if (p === "CATEGORY_INTRO") main = <CategoryIntro view={view} />;
  else if (p === "BOARD") main = <Board view={view} />;
  else if (CLUE_SCREENS.includes(p)) main = <ClueScreen view={view} serverNow={serverNow} />;
  else if (p === "CLUE_REVEAL_GUESSES" || p === "CLUE_RESULTS") main = <Guesses view={view} />;
  else if (p === "DD_STING") main = <DdSting view={view} />;
  else if (p === "DD_WAGER") main = <DdWager view={view} />;
  else if (p === "DD_RESULT") main = <DdResult view={view} />;
  else if (p === "FINAL_CATEGORY" || p === "FINAL_WAGER") main = <FinalCategory view={view} />;
  else if (p === "FINAL_REVEAL") main = <FinalReveal view={view} />;
  else main = <Podium view={view} />;

  return (
    <Stage>
      <ConnBadge status={status} />
      <div className="absolute inset-0 stars-bg flex flex-col">
        <div className="relative flex-1 min-h-0">{main}</div>
        {showScoreboard && <Scoreboard view={view} />}
      </div>
    </Stage>
  );
}

// ---------------- Lobby ----------------

function Lobby({ view }: { view: View }) {
  const [qr, setQr] = useState("");
  const joinUrl = `${location.origin}/?room=${view.roomCode}`;
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { width: 400, margin: 1, color: { dark: "#0A3161", light: "#FFFFFF" } }).then(setQr);
  }, [joinUrl]);
  return (
    <div className="absolute inset-0 flex stripes-bg">
      <div className="w-[760px] flex flex-col items-center justify-center gap-6 bg-navy-dark/70 px-10">
        <div className="font-display text-[88px] leading-none text-center text-shadow">🎆 {view.title} 🎆</div>
        <div className="text-[34px] text-cream">Join on your phone at</div>
        <div className="font-display text-[64px] leading-none text-gold">{location.host}</div>
        {qr && <img src={qr} alt="QR code" className="w-[340px] h-[340px] rounded-2xl border-8 border-white" />}
        <div className="text-[30px] text-cream">Room code</div>
        <div className="font-display text-[150px] leading-none tracking-[0.15em] bg-white text-navy rounded-3xl px-10">{view.roomCode}</div>
      </div>
      <div className="flex-1 p-14 flex flex-col">
        <div className="font-display text-[72px] mb-8">Teams ({view.teams.length}/7)</div>
        {view.teams.length === 0 && <div className="text-[40px] text-cream/70">Waiting for teams to join…</div>}
        <div className="grid grid-cols-2 gap-6">
          {view.teams.map((t) => (
            <div key={t.id} className="anim-pop flex items-center gap-6 rounded-3xl bg-white/10 border-2 border-white/20 p-6">
              <div className="text-[90px] leading-none">{t.icon}</div>
              <div className="min-w-0">
                <div className="font-display text-[56px] leading-none truncate">{t.name}</div>
                <div className="text-[26px] text-cream/80 truncate">{t.members.join(" · ")}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- Category intro ----------------

function CategoryIntro({ view }: { view: View }) {
  const i = view.categoryIntroIndex;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center stripes-bg overflow-hidden">
      <div className="text-[40px] text-cream/80 mb-6 anim-fade" key={`n${i}`}>Category {i + 1} of {view.board.length}</div>
      <div key={i} className="anim-swoosh tile rounded-[40px] px-24 py-20 max-w-[1600px] text-center">
        <div className="font-display text-[170px] leading-[0.95] text-shadow">{view.board[i]?.name}</div>
      </div>
    </div>
  );
}

// ---------------- Board ----------------

function Board({ view }: { view: View }) {
  return (
    <div className="absolute inset-0 p-6 grid grid-cols-6 grid-rows-[150px_repeat(5,1fr)] gap-3">
      {view.board.map((c, ci) => (
        <div key={`h${ci}`} className="tile rounded-xl flex items-center justify-center text-center px-3" style={{ gridColumn: ci + 1, gridRow: 1 }}>
          <div className="font-display text-[44px] leading-[1] text-shadow">{c.name}</div>
        </div>
      ))}
      {view.board.map((c, ci) => c.values.map((v, i) => {
        const used = view.usedClues.includes(`${ci}-${i}`);
        return (
          <div key={`${ci}-${i}`} className={`rounded-xl flex items-center justify-center ${used ? "bg-navy-dark/60" : "tile"}`}
            style={{ gridColumn: ci + 1, gridRow: i + 2 }}>
            {!used && <div className="font-display text-[84px] leading-none text-gold text-shadow">{v}</div>}
          </div>
        );
      }))}
    </div>
  );
}

// ---------------- Clue ----------------

function ClueHeader({ view }: { view: View }) {
  const c = view.currentClue!;
  const ctl = teamById(view, view.controlTeamId);
  if (c.cat === -1) return <div className="font-display text-[56px] text-gold">Final Jeopardy · {c.category}</div>;
  if (c.dailyDouble) {
    return (
      <div className="font-display text-[56px] text-gold">
        Daily Double · {c.category} · {ctl?.icon} {ctl?.name} wagered {view.ddWager ?? "?"}
      </div>
    );
  }
  return <div className="font-display text-[56px] text-gold">{c.category} · {c.value}</div>;
}

function ClueScreen({ view, serverNow }: { view: View; serverNow: () => number }) {
  const c = view.currentClue!;
  const ctl = teamById(view, view.controlTeamId);
  const ddWaiting = view.phase === "DD_ANSWERING" && view.timerEndsAt == null;
  const long = c.clue.length > 120;
  return (
    <div className="absolute inset-0 flex flex-col px-20 py-10">
      <ClueHeader view={view} />
      <div key={`${c.cat}-${c.idx}`} className="anim-zoom flex-1 min-h-0 flex flex-col items-center justify-center gap-8 text-center">
        <div className={`font-extrabold leading-tight text-shadow max-w-[1700px] ${c.image ? "text-[56px]" : long ? "text-[60px]" : "text-[76px]"}`}>
          {c.clue}
        </div>
        {c.image && <img src={c.image} alt="" className="max-h-[520px] max-w-full object-contain rounded-2xl" />}
        {c.verbal && view.phase.startsWith("DD_") && (
          <div className="text-[44px] text-gold font-bold">🎤 {ctl?.icon} {ctl?.name}, answer out loud!</div>
        )}
      </div>
      <div className="h-[80px] flex items-center">
        {view.timerEndsAt != null ? (
          <TimerBar big endsAt={view.timerEndsAt} duration={view.timerDuration} serverNow={serverNow} />
        ) : view.phase === "CLUE_JUDGING" || view.phase === "FINAL_REVEAL" || ddWaiting ? (
          <div className="w-full text-center text-[40px] text-cream">⏱️ Time's up! The host is judging…</div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------- Reveal guesses / results ----------------

function GuessCard({ team, sub, state, delayMs = 0 }: { team: PublicTeam; sub?: ViewSubmission; state: "neutral" | "correct" | "wrong"; delayMs?: number }) {
  const bg = state === "correct" ? "bg-good border-good" : state === "wrong" ? "bg-bad border-bad" : "bg-white/10 border-white/30";
  return (
    <div className={`rounded-3xl border-4 p-6 flex flex-col gap-2 ${bg} ${state === "neutral" ? "anim-pop" : "anim-flip"}`}
      style={{ animationDelay: `${delayMs}ms`, transition: "background-color .3s" }}>
      <div className="flex items-center gap-3">
        <span className="text-[48px] leading-none">{team.icon}</span>
        <span className="font-display text-[40px] leading-none truncate">{team.name}</span>
        {state !== "neutral" && <span className="ml-auto text-[48px] leading-none">{state === "correct" ? "✅" : "❌"}</span>}
      </div>
      <div className={`text-[44px] font-bold leading-tight break-words ${sub?.text ? "" : "italic text-white/60"}`}>
        {sub?.text || "— no answer —"}
      </div>
    </div>
  );
}

function Guesses({ view }: { view: View }) {
  const c = view.currentClue!;
  const results = view.phase === "CLUE_RESULTS";
  const [flipped, setFlipped] = useState(results ? 0 : -1);

  // Flip results one by one, dinging for each correct answer.
  useEffect(() => {
    if (!results) return;
    setFlipped(0);
    let i = 0;
    const subs = view.teams.map((t) => view.submissions.find((s) => s.teamId === t.id));
    const timer = setInterval(() => {
      i++;
      setFlipped(i);
      if (subs[i - 1]?.judged === "correct") audio.ding();
      if (i >= subs.length) {
        clearInterval(timer);
        if (subs.some((s) => s?.judged === "correct")) confettiBurst();
      }
    }, 550);
    return () => clearInterval(timer);
  }, [results]);

  const shown = results ? view.teams : view.teams.slice(0, view.revealIndex);
  const cols = view.teams.length <= 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className="absolute inset-0 flex flex-col px-16 py-8 gap-6">
      <div className="flex items-baseline gap-6">
        <ClueHeader view={view} />
      </div>
      <div className="text-[34px] text-cream leading-snug line-clamp-2">{c.clue}</div>
      {results && c.answer && (
        <div className="anim-pop rounded-3xl bg-white text-navy px-10 py-5 text-center">
          <span className="text-[32px] font-semibold mr-4">Correct answer:</span>
          <span className="font-display text-[80px] leading-none">{c.answer}</span>
        </div>
      )}
      <div className={`grid ${cols} gap-5 content-start`}>
        {shown.map((t, i) => {
          const sub = view.submissions.find((s) => s.teamId === t.id);
          const state = results && i < flipped ? (sub?.judged === "correct" ? "correct" : "wrong") : "neutral";
          return <GuessCard key={`${t.id}-${state}`} team={t} sub={sub} state={state} />;
        })}
      </div>
      {!results && view.revealIndex === 0 && (
        <div className="flex-1 flex items-center justify-center text-[56px] font-display text-cream">Let's see your answers…</div>
      )}
    </div>
  );
}

// ---------------- Daily Double ----------------

function DdSting({ view }: { view: View }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 bg-flag/30">
      <div className="anim-zoom">
        <div className="anim-dd font-display text-[260px] leading-none text-gold text-shadow">DAILY DOUBLE!</div>
      </div>
      <div className="font-display text-[80px] anim-fade" style={{ animationDelay: "0.8s" }}>{view.currentClue?.category}</div>
    </div>
  );
}

function DdWager({ view }: { view: View }) {
  const t = teamById(view, view.controlTeamId);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8">
      <div className="font-display text-[90px] text-gold">Daily Double · {view.currentClue?.category}</div>
      <div className="text-[150px] leading-none">{t?.icon}</div>
      <div className="font-display text-[110px] leading-none">{t?.name}</div>
      <div className="text-[56px] text-cream animate-pulse">is wagering… (up to {view.ddMax})</div>
    </div>
  );
}

function DdResult({ view }: { view: View }) {
  const t = teamById(view, view.controlTeamId);
  const sub = view.submissions.find((s) => s.teamId === view.controlTeamId);
  const correct = sub?.judged === "correct";
  const [showAnswer, setShowAnswer] = useState(false);
  useEffect(() => {
    if (correct) { audio.ding(); confettiBurst(); }
    const timer = setTimeout(() => setShowAnswer(true), 1600);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 px-20">
      <div className="font-display text-[64px] text-gold">Daily Double · {view.currentClue?.category}</div>
      <div className={`anim-flip rounded-[40px] px-20 py-10 flex flex-col items-center gap-4 ${correct ? "bg-good" : "bg-bad"}`}>
        <div className="flex items-center gap-6">
          <span className="text-[110px] leading-none">{t?.icon}</span>
          <span className="font-display text-[100px] leading-none">{t?.name}</span>
        </div>
        {sub?.text && <div className="text-[48px] font-bold">“{sub.text}”</div>}
        <div className="font-display text-[110px] leading-none">
          {correct ? "✅ CORRECT" : "❌ WRONG"} {correct ? "+" : "−"}{view.ddWager}
        </div>
      </div>
      {showAnswer && view.currentClue?.answer && (
        <div className="anim-pop rounded-3xl bg-white text-navy px-12 py-6 text-center max-w-[1700px]">
          <div className="text-[32px] font-semibold">The answer</div>
          <div className={`font-bold leading-snug ${view.currentClue.answer.length > 80 ? "text-[44px]" : "text-[80px] font-display"}`}>
            {view.currentClue.answer}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Final ----------------

function FinalCategory({ view }: { view: View }) {
  const wagering = view.phase === "FINAL_WAGER";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-10">
      <div className="font-display text-[110px] text-gold leading-none text-shadow">Final Jeopardy</div>
      <div className="anim-swoosh tile rounded-[40px] px-24 py-16">
        <div className="font-display text-[150px] leading-none text-shadow">{view.finalCategory}</div>
      </div>
      {wagering && <div className="text-[56px] text-cream animate-pulse">Lock in your wagers on your phones!</div>}
    </div>
  );
}

function FinalReveal({ view }: { view: View }) {
  const n = view.finalRevealIndex;
  const currentId = n > 0 ? view.finalOrder[n - 1] : null;
  const allDone = n >= view.finalOrder.length && n > 0;
  const c = view.currentClue;
  return (
    <div className="absolute inset-0 flex flex-col items-center px-16 py-10 gap-8">
      <div className="font-display text-[64px] text-gold">Final Jeopardy · {view.finalCategory}</div>
      {!currentId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="font-display text-[110px]">The answers are in!</div>
          <div className="text-[44px] text-cream">Revealing from lowest score to highest…</div>
        </div>
      ) : (
        <FinalSpotlight key={currentId} view={view} teamId={currentId} />
      )}
      {allDone && c?.answer && (
        <div className="anim-pop rounded-3xl bg-white text-navy px-12 py-4 text-center">
          <span className="text-[32px] font-semibold mr-4">Correct answer:</span>
          <span className="font-display text-[72px] leading-none">{c.answer}</span>
        </div>
      )}
    </div>
  );
}

function FinalSpotlight({ view, teamId }: { view: View; teamId: string }) {
  const t = teamById(view, teamId);
  const sub = view.submissions.find((s) => s.teamId === teamId);
  const r = view.finalResults[teamId];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ts = [
      setTimeout(() => { setStep(1); if (r?.correct) audio.ding(); }, 1400),
      setTimeout(() => setStep(2), 2600),
      setTimeout(() => { setStep(3); if (r?.correct) confettiBurst(); }, 3800),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);
  if (!t || !r) return null;
  const bg = step >= 1 ? (r.correct ? "bg-good border-good" : "bg-bad border-bad") : "bg-white/10 border-white/30";
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 w-full">
      <div className="flex items-center gap-6 anim-pop">
        <span className="text-[120px] leading-none">{t.icon}</span>
        <span className="font-display text-[110px] leading-none">{t.name}</span>
      </div>
      <div className={`rounded-[40px] border-4 px-16 py-8 min-w-[900px] text-center transition-colors duration-500 ${bg}`}>
        <div className={`text-[72px] font-extrabold leading-tight ${sub?.text ? "" : "italic opacity-70"}`}>
          {sub?.text || "— no answer —"} {step >= 1 && (r.correct ? "✅" : "❌")}
        </div>
      </div>
      <div className="flex gap-16 items-end h-[140px]">
        {step >= 2 && (
          <div className="anim-pop text-center">
            <div className="text-[32px] text-cream">Wager</div>
            <div className="font-display text-[96px] leading-none">{r.wager === 0 ? "" : r.correct ? "+" : "−"}{r.wager}</div>
          </div>
        )}
        {step >= 3 && (
          <div className="anim-pop text-center">
            <div className="text-[32px] text-cream">New score</div>
            <div className="font-display text-[110px] leading-none text-gold">{fmtScore(r.after)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Podium ----------------

function Podium({ view }: { view: View }) {
  useEffect(() => { podiumCelebration(); }, []);
  const ranked = rankTeams(view.teams);
  const at = (p: number) => ranked.filter((r) => r.place === p).map((r) => r.team);
  const steps = [
    { place: 2, h: 260, color: "bg-white text-navy" },
    { place: 1, h: 360, color: "bg-gold text-navy" },
    { place: 3, h: 190, color: "bg-flag text-white" },
  ];
  return (
    <div className="absolute inset-0 flex flex-col items-center px-16 pt-8 pb-6">
      <div className="font-display text-[110px] leading-none text-gold text-shadow">🏆 Champions 🏆</div>
      <div className="flex items-end justify-center gap-6 mt-auto">
        {steps.map(({ place, h, color }, i) => {
          const teams = at(place);
          return (
            <div key={place} className="flex flex-col items-center w-[480px]" style={{ animationDelay: `${(2 - place) * 0.4 + 0.2}s` }}>
              <div className="flex flex-wrap justify-center gap-6 mb-4">
                {teams.map((t) => (
                  <div key={t.id} className="anim-pop flex flex-col items-center text-center" style={{ animationDelay: `${0.9 + i * 0.2}s` }}>
                    <div className="text-[100px] leading-none">{t.icon}</div>
                    <div className="font-display text-[52px] leading-none">{t.name}</div>
                    <div className="text-[22px] text-cream/80 max-w-[300px]">{t.members.join(", ")}</div>
                    <div className="font-display text-[48px] text-gold leading-none mt-1">{fmtScore(t.score)}</div>
                  </div>
                ))}
              </div>
              <div className={`anim-rise w-full rounded-t-3xl flex items-start justify-center pt-6 ${color}`} style={{ height: h }}>
                <span className="font-display text-[120px] leading-none">{ordinal(place)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="w-full max-w-[1500px] mt-4 grid grid-cols-2 gap-x-10 gap-y-1 text-[30px] bg-navy-dark/70 rounded-2xl px-8 py-3">
        {ranked.map(({ team, place }) => (
          <div key={team.id} className="flex items-center gap-4">
            <span className="font-display w-16 text-gold">{ordinal(place)}</span>
            <span>{team.icon}</span>
            <span className="font-semibold truncate">{team.name}</span>
            <span className="ml-auto font-display">{fmtScore(team.score)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Scoreboard ----------------

function Scoreboard({ view }: { view: View }) {
  const p = view.phase;
  let checks: Set<string> | null = null;
  if (p === "FINAL_WAGER") checks = new Set(view.finalWagersLocked);
  else if (["CLUE_ANSWERING", "CLUE_JUDGING", "DD_ANSWERING", "FINAL_ANSWERING"].includes(p)) {
    checks = new Set(view.submissions.filter((s) => s.submitted).map((s) => s.teamId));
  }
  const showControl = !p.startsWith("FINAL");
  return (
    <div className="h-[170px] shrink-0 bg-navy-dark/90 border-t-4 border-flag flex items-stretch gap-3 px-4 py-3">
      {view.teams.map((t) => {
        const ctl = showControl && t.id === view.controlTeamId;
        return (
          <div key={t.id} className={`relative flex-1 min-w-0 rounded-2xl flex flex-col items-center justify-center px-2 ${ctl ? "bg-navy-light anim-glow" : "bg-white/5"} ${t.connected ? "" : "opacity-60"}`}>
            {ctl && <div className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-b-lg bg-gold text-navy text-[20px] font-extrabold px-3 leading-tight">🎯 IN CONTROL</div>}
            {checks?.has(t.id) && <div className="absolute top-1 right-2 text-[38px]">✅</div>}
            <div className="flex items-center gap-2 max-w-full mt-2">
              <span className="text-[40px] leading-none">{t.icon}</span>
              <span className="text-[30px] font-bold truncate">{t.name}</span>
            </div>
            <AnimatedNumber value={t.score} className={`font-display text-[60px] leading-none ${t.score < 0 ? "text-flag" : ""}`} />
          </div>
        );
      })}
    </div>
  );
}
