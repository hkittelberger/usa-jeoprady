// Auto-marking (SPEC §7).

export function normalize(s: string): string {
  let t = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  t = t.replace(/[.'’‘`]/g, "");
  t = t.replace(/[^a-z0-9\s]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^(the|a|an) /, "");
  return t;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type MatchSpec = { answer: string; accept?: string[]; matchMode?: "any" | "allOf" };
export type MatchResult = { auto: "correct" | "pending"; closeMatch: boolean; blank: boolean };

export function autoMark(text: string, spec: MatchSpec): MatchResult {
  const sub = normalize(text);
  if (!sub) return { auto: "pending", closeMatch: false, blank: true };
  const accepted = [spec.answer, ...(spec.accept ?? [])].map(normalize).filter(Boolean);

  if (spec.matchMode === "allOf" && spec.accept?.length) {
    const padded = ` ${sub} `;
    const ok = spec.accept.map(normalize).every((item) => padded.includes(` ${item} `));
    if (ok) return { auto: "correct", closeMatch: false, blank: false };
  } else if (accepted.includes(sub)) {
    return { auto: "correct", closeMatch: false, blank: false };
  }

  const closeMatch = accepted.some((a) => {
    const d = levenshtein(sub, a);
    return d <= 2 || d <= 0.2 * a.length;
  });
  return { auto: "pending", closeMatch, blank: false };
}
