import { issueAdminToken, pinMatches, verifyAdminToken } from "./auth";
import type { Env } from "./env";

export { GameRoom } from "./room";

// No ambiguous characters (no I/O, no digits).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function randomCode(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

const roomStub = (env: Env, code: string) => env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
const cleanCode = (c: string) => (/^[A-Za-z]{4}$/.test(c) ? c.toUpperCase() : null);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/admin/login" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { pin?: unknown };
      if (!env.ADMIN_PIN) return json({ error: "ADMIN_PIN is not configured on the server" }, 500);
      if (!pinMatches(body.pin, env.ADMIN_PIN)) return json({ error: "Wrong PIN" }, 401);
      return json({ token: await issueAdminToken(env.ADMIN_PIN) });
    }

    if (path === "/api/rooms" && request.method === "POST") {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
      if (!(await verifyAdminToken(token, env.ADMIN_PIN))) return json({ error: "Not authorized" }, 401);
      for (let i = 0; i < 20; i++) {
        const code = randomCode();
        if (await roomStub(env, code).create(code)) return json({ code });
      }
      return json({ error: "Could not allocate a room code" }, 500);
    }

    let m = path.match(/^\/api\/rooms\/([^/]+)$/);
    if (m && request.method === "GET") {
      const code = cleanCode(m[1]);
      return json({ exists: !!code && (await roomStub(env, code).exists()), code });
    }

    m = path.match(/^\/api\/ws\/([^/]+)$/);
    if (m) {
      const code = cleanCode(m[1]);
      if (!code) return new Response("Bad room code", { status: 400 });
      return roomStub(env, code).fetch(request);
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
