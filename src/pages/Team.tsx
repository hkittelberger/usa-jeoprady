import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TEAM_ICONS, type ClientMsg, type ServerMsg, type View } from "../../shared/types";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { ConnBadge } from "../components/ConnBadge";
import { TimerBar } from "../components/TimerBar";
import { useToast } from "../components/Toast";
import { useRoom } from "../lib/socket";
import { ordinal, rankTeams, roomFromUrl, setRoomInUrl, teamById } from "../lib/util";

type Creds = { teamId: string; token: string };
const credKey = (room: string) => `jeopardy:team:${room}`;
function loadCreds(room: string): Creds | null {
  try { return JSON.parse(localStorage.getItem(credKey(room)) ?? "null"); } catch { return null; }
}

export default function Team() {
  const [room, setRoom] = useState<string | null>(roomFromUrl());
  if (!room) return <RoomEntry onRoom={(c) => { setRoomInUrl(c); setRoom(c); }} />;
  return <TeamRoom room={room} onLeave={() => { setRoomInUrl(null); setRoom(null); }} />;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-full stars-bg flex flex-col">{children}</div>;
}

function RoomEntry({ onRoom }: { onRoom: (c: string) => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  return (
    <Shell>
      <form className="flex-1 flex flex-col justify-center gap-5 p-6 max-w-md mx-auto w-full"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!/^[A-Za-z]{4}$/.test(code)) return setErr("Room codes are 4 letters.");
          const r = await fetch(`/api/rooms/${code}`).then((r) => r.json()).catch(() => ({ exists: false }));
          if (!r.exists) return setErr("We couldn't find that room. Check the code on the TV.");
          onRoom(code.toUpperCase());
        }}>
        <div className="text-center">
          <div className="text-6xl">🎆</div>
          <h1 className="font-display text-5xl mt-2">July 4th in November</h1>
        </div>
        <label className="text-cream font-semibold">Room code</label>
        <input className="input text-center font-display text-5xl tracking-[0.3em] uppercase" autoCapitalize="characters" autoComplete="off"
          value={code} onChange={(e) => { setErr(""); setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4)); }} />
        {err && <div className="text-gold">{err}</div>}
        <button className="btn-red text-xl py-4">Next</button>
      </form>
    </Shell>
  );
}

function TeamRoom({ room, onLeave }: { room: string; onLeave: () => void }) {
  const [creds, setCreds] = useState<Creds | null>(() => loadCreds(room));
  const credsRef = useRef(creds);
  credsRef.current = creds;
  const toast = useToast();

  const onMessage = useCallback((m: ServerMsg) => {
    if (m.type === "joined") {
      const c = { teamId: m.teamId, token: m.token };
      localStorage.setItem(credKey(room), JSON.stringify(c));
      setCreds(c);
    } else if (m.type === "error" && m.message !== "Answers are locked right now.") {
      toast.show(m.message);
    }
  }, [room, toast.show]);

  const { view, status, send, serverNow } = useRoom(
    room,
    () => ({ type: "hello", role: "team", teamId: credsRef.current?.teamId, token: credsRef.current?.token }),
    onMessage,
  );

  // Credentials no longer valid (team removed / game reset elsewhere) → forget them.
  useEffect(() => {
    if (view && creds && !view.me) {
      localStorage.removeItem(credKey(room));
      setCreds(null);
    }
  }, [view, creds, room]);

  if (status === "notfound") {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-2xl">Room {room} doesn't exist.</div>
          <button className="btn-white" onClick={onLeave}>Enter a different code</button>
        </div>
      </Shell>
    );
  }
  if (!view) return <Shell><div className="flex-1 flex items-center justify-center text-xl">Connecting…</div></Shell>;

  return (
    <Shell>
      <ConnBadge status={status} />
      {view.me ? <InGame view={view} send={send} serverNow={serverNow} /> : <JoinForm view={view} send={send} onLeave={onLeave} />}
      {toast.node}
    </Shell>
  );
}

// ---------------- Join ----------------

function JoinForm({ view, send, onLeave }: { view: View; send: (m: ClientMsg) => boolean; onLeave: () => void }) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([""]);
  const [icon, setIcon] = useState<string | null>(null);
  const taken = new Set(view.teams.map((t) => t.icon));
  const existing = view.teams.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const full = view.teams.length >= 7;
  const validNew = name.trim() && members.some((m) => m.trim()) && icon && !taken.has(icon);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (existing) send({ type: "join", name: name.trim(), members: [], icon: "" });
    else if (validNew) send({ type: "join", name: name.trim(), members: members.map((m) => m.trim()).filter(Boolean), icon: icon! });
  };

  return (
    <form className="flex-1 flex flex-col gap-5 p-5 max-w-md mx-auto w-full pb-10" onSubmit={submit}>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">Join game</h1>
        <button type="button" onClick={onLeave} className="rounded-lg bg-white/10 px-3 py-1 font-display text-2xl tracking-widest">{view.roomCode}</button>
      </div>
      {full && !existing && (
        <div className="rounded-xl bg-flag p-4">This game is full (7 teams). Team up with another group — or enter your existing team name to rejoin.</div>
      )}
      <div>
        <label className="text-cream font-semibold">Team name</label>
        <input className="input mt-1" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Founding Fathers" />
        <div className="text-sm text-cream/70 mt-1">Already joined on another phone? Type the same team name to rejoin.</div>
      </div>

      {existing ? (
        <button className="btn-gold text-xl py-4">Rejoin as {existing.icon} {existing.name}</button>
      ) : (
        <>
          <div>
            <label className="text-cream font-semibold">Team members</label>
            <div className="flex flex-col gap-2 mt-1">
              {members.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input" maxLength={30} value={m} placeholder={`Player ${i + 1}`}
                    onChange={(e) => setMembers(members.map((x, j) => (j === i ? e.target.value : x)))} />
                  {members.length > 1 && (
                    <button type="button" className="btn-ghost px-4" aria-label="Remove" onClick={() => setMembers(members.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              ))}
              {members.length < 6 && (
                <button type="button" className="btn-ghost" onClick={() => setMembers([...members, ""])}>+ Add member</button>
              )}
            </div>
          </div>
          <div>
            <label className="text-cream font-semibold">Pick your icon</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {TEAM_ICONS.map((ic) => {
                const isTaken = taken.has(ic);
                const sel = icon === ic;
                return (
                  <button type="button" key={ic} disabled={isTaken} onClick={() => setIcon(ic)}
                    className={`aspect-square rounded-xl text-4xl flex items-center justify-center transition ${sel ? "bg-gold scale-105" : "bg-white/10"} ${isTaken ? "opacity-25 grayscale" : ""}`}>
                    {ic}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn-red text-xl py-4" disabled={!validNew || full}>Join!</button>
        </>
      )}
    </form>
  );
}

// ---------------- In game ----------------

function InGame({ view, send, serverNow }: { view: View; send: (m: ClientMsg) => boolean; serverNow: () => number }) {
  const me = view.me!;
  const team = teamById(view, me.teamId)!;
  const p = view.phase;
  const ctl = teamById(view, view.controlTeamId);
  const inControl = view.controlTeamId === me.teamId;
  const c = view.currentClue;
  const mySub = view.submissions.find((s) => s.teamId === me.teamId);

  let body: ReactNode;
  if (p === "LOBBY") {
    body = (
      <Center>
        <div className="text-7xl">{team.icon}</div>
        <div className="text-3xl font-bold">You're in!</div>
        <div className="font-display text-5xl">{team.name}</div>
        <div className="text-cream/80">{team.members.join(" · ")}</div>
        <div className="mt-6 text-xl animate-pulse">Waiting for the host…</div>
      </Center>
    );
  } else if (p === "CATEGORY_INTRO") {
    body = <Center><div className="font-display text-6xl animate-pulse">Get ready…</div><div className="text-cream">Eyes on the TV 📺</div></Center>;
  } else if (p === "BOARD") {
    body = inControl
      ? <Center><div className="text-6xl">🎯</div><div className="font-display text-5xl text-gold">You're in control!</div><div className="text-xl">Tell the host which clue you want.</div></Center>
      : <Center><div className="text-6xl">{ctl?.icon}</div><div className="text-2xl"><b>{ctl?.name}</b> is picking a clue…</div></Center>;
  } else if (["CLUE_READING", "CLUE_ANSWERING", "CLUE_JUDGING", "CLUE_REVEAL_GUESSES", "FINAL_READING", "FINAL_ANSWERING"].includes(p)) {
    body = <AnswerPanel view={view} send={send} serverNow={serverNow} />;
  } else if (p === "CLUE_RESULTS") {
    const ok = mySub?.judged === "correct";
    body = (
      <Center>
        <div className={`rounded-3xl p-8 w-full ${ok ? "bg-good" : "bg-bad"}`}>
          <div className="font-display text-6xl">{ok ? `✅ Correct! +${c?.value}` : "❌ Not this time"}</div>
          {mySub?.text && <div className="mt-2 text-lg opacity-90">You said: “{mySub.text}”</div>}
        </div>
        {!ok && c?.answer && <div className="text-xl">The answer was <b>{c.answer}</b></div>}
      </Center>
    );
  } else if (p === "DD_STING") {
    body = <Center><div className="font-display text-7xl text-gold animate-bounce">Daily Double!</div><div className="text-xl">{c?.category}</div></Center>;
  } else if (p === "DD_WAGER") {
    body = inControl
      ? <WagerPanel title="Daily Double wager" max={view.ddMax ?? 1000} current={view.ddWagerDraft}
          hint="The host will lock it in." onSend={(amount) => send({ type: "ddWager", amount })} />
      : <Center><div className="text-6xl">🎯</div><div className="text-2xl"><b>{ctl?.icon} {ctl?.name}</b> is wagering…</div></Center>;
  } else if (p === "DD_READING" || p === "DD_ANSWERING") {
    if (!inControl) body = <Center><div className="text-2xl"><b>{ctl?.icon} {ctl?.name}</b> is answering the Daily Double for {view.ddWager}…</div></Center>;
    else if (c?.verbal) body = <Center><div className="text-6xl">🎤</div><div className="font-display text-5xl text-gold">Answer out loud!</div><div className="text-lg">{c.clue}</div>{view.timerEndsAt && <TimerBar endsAt={view.timerEndsAt} duration={view.timerDuration} serverNow={serverNow} />}</Center>;
    else body = <AnswerPanel view={view} send={send} serverNow={serverNow} />;
  } else if (p === "DD_RESULT") {
    const sub = view.submissions[0];
    const ok = sub?.judged === "correct";
    body = (
      <Center>
        <div className={`rounded-3xl p-8 w-full ${ok ? "bg-good" : "bg-bad"}`}>
          <div className="text-xl">{ctl?.icon} {inControl ? "You" : ctl?.name}</div>
          <div className="font-display text-6xl">{ok ? `✅ +${view.ddWager}` : `❌ −${view.ddWager}`}</div>
        </div>
        {c?.answer && <div className="text-lg">The answer: <b>{c.answer}</b></div>}
      </Center>
    );
  } else if (p === "FINAL_CATEGORY") {
    body = <Center><div className="font-display text-4xl text-gold">Final Jeopardy</div><div className="font-display text-6xl">{view.finalCategory}</div><div className="text-cream">Wagers are coming up…</div></Center>;
  } else if (p === "FINAL_WAGER") {
    body = (
      <WagerPanel title={`Final wager · ${view.finalCategory}`} max={me.finalMax} current={me.finalWager}
        hint={me.finalMax === 0 ? "You can still play — your wager is 0." : "You can change it until the host locks wagers."}
        onSend={(amount) => send({ type: "finalWager", amount })} />
    );
  } else if (p === "FINAL_REVEAL") {
    const r = view.finalResults[me.teamId];
    body = r ? (
      <Center>
        <div className={`rounded-3xl p-8 w-full ${r.correct ? "bg-good" : "bg-bad"}`}>
          <div className="font-display text-6xl">{r.correct ? "✅" : "❌"} {r.wager === 0 ? "±0" : `${r.correct ? "+" : "−"}${r.wager}`}</div>
          <div className="text-xl mt-2">New score: <b>{r.after}</b></div>
        </div>
        {c?.answer && <div className="text-lg">The answer: <b>{c.answer}</b></div>}
      </Center>
    ) : (
      <Center>
        <div className="text-lg text-cream">Your final answer</div>
        <div className="text-3xl font-bold">“{mySub?.text || "—"}”</div>
        <div className="text-xl animate-pulse mt-4">Revealing on the TV…</div>
      </Center>
    );
  } else {
    const r = rankTeams(view.teams).find((x) => x.team.id === me.teamId);
    body = (
      <Center>
        <div className="text-7xl">{r?.place === 1 ? "🏆" : r?.place === 2 ? "🥈" : r?.place === 3 ? "🥉" : "🎆"}</div>
        <div className="font-display text-7xl text-gold">{r ? ordinal(r.place) : ""} place</div>
        <div className="text-2xl">{team.icon} {team.name} · {team.score}</div>
        <div className="text-cream mt-4">Thanks for playing! 🇺🇸</div>
      </Center>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 bg-navy-dark/80 border-b-4 border-flag px-4 py-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <span className="text-3xl">{team.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate">{team.name}</div>
          {inControl && !p.startsWith("FINAL") && p !== "LOBBY" && p !== "PODIUM" && <div className="text-xs text-gold font-bold">🎯 IN CONTROL</div>}
        </div>
        <AnimatedNumber value={team.score} className="font-display text-4xl" />
      </div>
      <div className="flex-1 flex flex-col p-5 max-w-md mx-auto w-full">{body}</div>
    </>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">{children}</div>;
}

function AnswerPanel({ view, send, serverNow }: { view: View; send: (m: ClientMsg) => boolean; serverNow: () => number }) {
  const me = view.me!;
  const c = view.currentClue!;
  const clueKey = `${c.cat}-${c.idx}`;
  const canType = view.timerEndsAt != null && ["CLUE_ANSWERING", "DD_ANSWERING", "FINAL_ANSWERING"].includes(view.phase);
  const locked = !canType && !["CLUE_READING", "DD_READING", "FINAL_READING"].includes(view.phase);

  const [text, setText] = useState(me.draft);
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(me.submitted ? me.draft : null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // New clue → start from whatever the server has (usually empty).
  useEffect(() => {
    setText(me.draft);
    setLastSubmitted(me.submitted ? me.draft : null);
  }, [clueKey]);
  // After a refresh/reconnect, restore the server's draft if we have nothing locally.
  useEffect(() => {
    if (!text && me.draft) setText(me.draft);
  }, [me.draft]);
  useEffect(() => () => clearTimeout(debounce.current), []);

  const onChange = (v: string) => {
    setText(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => send({ type: "draft", text: v }), 300);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canType) return;
    clearTimeout(debounce.current);
    if (send({ type: "submit", text })) setLastSubmitted(text);
  };

  const finalTxt = locked ? (view.submissions.find((s) => s.teamId === me.teamId)?.text ?? text) : text;
  const isSubmitted = lastSubmitted != null && lastSubmitted === text && text.trim() !== "";

  return (
    <form className="flex-1 flex flex-col gap-4" onSubmit={submit}>
      <div className="text-center">
        <div className="font-display text-3xl text-gold">{c.cat === -1 ? `Final Jeopardy · ${c.category}` : `${c.category} · ${c.dailyDouble ? `DD ${view.ddWager}` : c.value}`}</div>
        {c.clue && <div className="text-lg mt-1 text-cream">{c.clue}</div>}
      </div>
      <div className="h-10 flex items-center">
        {view.timerEndsAt != null && <TimerBar endsAt={view.timerEndsAt} duration={view.timerDuration} serverNow={serverNow} />}
      </div>
      {locked ? (
        <div className="rounded-2xl bg-white/10 p-5 text-center">
          <div className="text-sm text-cream">🔒 Locked in</div>
          <div className="text-2xl font-bold mt-1 break-words">{finalTxt.trim() ? `“${finalTxt}”` : "— no answer —"}</div>
          <div className="mt-3 animate-pulse">Eyes on the TV 📺</div>
        </div>
      ) : (
        <>
          <textarea
            className="input min-h-[120px] text-2xl resize-none"
            disabled={!canType}
            placeholder={canType ? "Type your answer…" : "Wait for the host…"}
            value={text}
            maxLength={300}
            autoCapitalize="sentences"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }}
          />
          <button className={`${isSubmitted ? "btn-gold" : "btn-red"} text-2xl py-4`} disabled={!canType || !text.trim()}>
            {isSubmitted ? "Submitted ✓ (tap to resubmit)" : "Submit"}
          </button>
          {canType && lastSubmitted != null && !isSubmitted && <div className="text-center text-sm text-gold">Edited — whatever is in the box when time runs out counts.</div>}
          {canType && lastSubmitted == null && <div className="text-center text-sm text-cream/70">Whatever is in the box when time runs out is submitted automatically.</div>}
        </>
      )}
    </form>
  );
}

function WagerPanel({ title, max, current, hint, onSend }: { title: string; max: number; current: number | null; hint: string; onSend: (n: number) => void }) {
  const [val, setVal] = useState(current != null ? String(current) : "");
  const n = Number(val);
  const valid = val !== "" && Number.isInteger(n) && n >= 0 && n <= max;
  return (
    <form className="flex-1 flex flex-col justify-center gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) onSend(n); }}>
      <div className="font-display text-4xl text-gold text-center">{title}</div>
      <div className="text-center text-cream">Wager 0 – {max}</div>
      <input className="input text-center font-display text-6xl" inputMode="numeric" pattern="[0-9]*" value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="0" />
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="btn-ghost" onClick={() => setVal("0")}>0</button>
        <button type="button" className="btn-ghost" onClick={() => setVal(String(Math.floor(max / 2)))}>Half</button>
        <button type="button" className="btn-ghost" onClick={() => setVal(String(max))}>All in ({max})</button>
      </div>
      <button className="btn-red text-2xl py-4" disabled={!valid}>{current != null ? "Update wager" : "Lock in wager"}</button>
      {current != null && <div className="text-center text-xl">✅ Wager sent: <b>{current}</b></div>}
      <div className="text-center text-sm text-cream/70">{hint}</div>
    </form>
  );
}
