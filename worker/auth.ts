// Stateless admin session tokens: "<expiryMs>.<hmac>" signed with ADMIN_PIN.

const enc = new TextEncoder();
const SESSION_MS = 7 * 24 * 3600 * 1000;

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`jeopardy-admin:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function pinMatches(pin: unknown, expected: string | undefined): boolean {
  return typeof pin === "string" && !!expected && safeEqual(pin, expected);
}

export async function issueAdminToken(secret: string): Promise<string> {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifyAdminToken(token: unknown, secret: string | undefined): Promise<boolean> {
  if (typeof token !== "string" || !secret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmac(secret, exp));
}
