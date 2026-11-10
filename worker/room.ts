import { DurableObject } from "cloudflare:workers";
import questions from "../src/data/questions.json";
import type { ClientMsg, GameData, ServerMsg } from "../shared/types";
import { verifyAdminToken } from "./auth";
import type { Env } from "./env";
import { GameError, adminAction, endTimer, joinTeam, newGame, teamDdWager, teamDraft, teamFinalWager, type GameState } from "./game";
import { buildView, type Viewer } from "./views";

const data = questions as GameData;

type Attachment = { role: "admin" | "tv" | "guest" } | { role: "team"; teamId: string };

/** One game room. Single source of truth; persisted on every change. */
export class GameRoom extends DurableObject<Env> {
  private state: GameState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<GameState>("state")) ?? null;
    });
  }

  // ---- RPC (from the Worker) ----

  async create(roomCode: string): Promise<boolean> {
    if (this.state) return false;
    this.state = newGame(roomCode);
    await this.ctx.storage.put("state", this.state);
    return true;
  }

  async exists(): Promise<boolean> {
    return !!this.state;
  }

  // ---- WebSocket ----

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (!this.state) return new Response("Room not found", { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: "guest" } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const s = this.state;
    if (!s || typeof raw !== "string" || raw.length > 10_000) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = (ws.deserializeAttachment() ?? { role: "guest" }) as Attachment;

    try {
      switch (msg.type) {
        case "ping":
          return send(ws, { type: "pong", t: msg.t, server: Date.now() });

        case "hello": {
          if (msg.role === "admin") {
            if (!(await verifyAdminToken(msg.token, this.env.ADMIN_PIN))) return send(ws, { type: "authFailed" });
            ws.serializeAttachment({ role: "admin" } satisfies Attachment);
          } else if (msg.role === "tv") {
            ws.serializeAttachment({ role: "tv" } satisfies Attachment);
          } else {
            const t = msg.teamId ? s.teams.find((x) => x.id === msg.teamId && x.token === msg.token) : undefined;
            ws.serializeAttachment((t ? { role: "team", teamId: t.id } : { role: "guest" }) satisfies Attachment);
          }
          return this.broadcast(); // connection status changed for everyone
        }

        case "join": {
          if (att.role !== "guest" && att.role !== "team") throw new GameError("Only team phones can join");
          const { team } = joinTeam(s, msg.name, msg.members, msg.icon);
          ws.serializeAttachment({ role: "team", teamId: team.id } satisfies Attachment);
          send(ws, { type: "joined", teamId: team.id, token: team.token });
          return this.commit();
        }

        case "draft":
        case "submit": {
          if (att.role !== "team") throw new GameError("Join a team first");
          const wasSubmitted = !!s.submitted[att.teamId];
          teamDraft(data, s, att.teamId, msg.text, msg.type === "submit");
          // Plain drafts only change what the admin sees.
          const onlyAdmin = msg.type === "draft" && wasSubmitted === !!s.submitted[att.teamId];
          return this.commit(onlyAdmin ? "admin" : "all");
        }

        case "ddWager":
          if (att.role !== "team") throw new GameError("Join a team first");
          teamDdWager(s, att.teamId, msg.amount);
          return this.commit();

        case "finalWager":
          if (att.role !== "team") throw new GameError("Join a team first");
          teamFinalWager(s, att.teamId, msg.amount);
          return this.commit();

        case "admin":
          if (att.role !== "admin") return send(ws, { type: "authFailed" });
          adminAction(data, s, msg.action, Date.now());
          return this.commit();
      }
    } catch (e) {
      if (e instanceof GameError) send(ws, { type: "error", message: e.message });
      else {
        console.error(e);
        send(ws, { type: "error", message: "Something went wrong" });
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    try { ws.close(); } catch { /* already closed */ }
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcast(ws);
  }

  async alarm() {
    const s = this.state;
    if (!s || s.timerEndsAt == null) return;
    if (Date.now() + 20 < s.timerEndsAt) {
      await this.ctx.storage.setAlarm(s.timerEndsAt);
      return;
    }
    try { endTimer(data, s, "timeout"); } catch (e) { if (!(e instanceof GameError)) throw e; }
    await this.commit();
  }

  // ---- internals ----

  private async commit(audience: "all" | "admin" = "all") {
    const s = this.state!;
    await this.ctx.storage.put("state", s);
    if (s.timerEndsAt != null) {
      if ((await this.ctx.storage.getAlarm()) !== s.timerEndsAt) await this.ctx.storage.setAlarm(s.timerEndsAt);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
    this.broadcast(undefined, audience);
  }

  private broadcast(exclude?: WebSocket, audience: "all" | "admin" = "all") {
    const s = this.state;
    if (!s) return;
    const sockets = this.ctx.getWebSockets().filter((w) => w !== exclude && w.readyState === WebSocket.OPEN);
    const atts = sockets.map((w) => (w.deserializeAttachment() ?? { role: "guest" }) as Attachment);
    const connected = new Set(atts.flatMap((a) => (a.role === "team" ? [a.teamId] : [])));
    const cache = new Map<string, string>();
    sockets.forEach((w, i) => {
      const a = atts[i];
      if (audience === "admin" && a.role !== "admin") return;
      const key = a.role === "team" ? `team:${a.teamId}` : a.role;
      let payload = cache.get(key);
      if (!payload) {
        const viewer: Viewer = a.role === "team" ? { role: "team", teamId: a.teamId } : { role: a.role };
        payload = JSON.stringify({ type: "state", view: buildView(data, s, viewer, connected) } satisfies ServerMsg);
        cache.set(key, payload);
      }
      try { w.send(payload); } catch { /* socket went away */ }
    });
  }
}

function send(ws: WebSocket, msg: ServerMsg) {
  try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
}
