import type { Verdict } from "@/src/core/types";

export const usdc = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export const stampDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

/** Word + shape for every verdict, so colour is never the only signal. */
export const VERDICT: Record<Verdict, { word: string; glyph: string; label: string }> = {
  PAY: { word: "PAY", glyph: "✓", label: "Approved to pay" },
  HOLD: { word: "HOLD", glyph: "‖", label: "Held for a person" },
  BLOCK: { word: "BLOCK", glyph: "✕", label: "Blocked" },
};

/** Find a cited quote in the invoice text, tolerant of quote marks and whitespace. */
export function locateQuote(text: string, quote: string): [number, number] | null {
  const q = quote.trim().replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "").trim();
  if (q.length < 4) return null;
  const at = text.indexOf(q);
  if (at >= 0) return [at, at + q.length];
  const lower = text.toLowerCase();
  const li = lower.indexOf(q.toLowerCase());
  return li >= 0 ? [li, li + q.length] : null;
}
