import "server-only";
import { dbPath, evalDir, isDemo } from "@/lib/demo";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "@/src/core/store";
import type { Verdict } from "@/src/core/types";

export interface ModeScore {
  model: { trapsCaught: string; cleanPaid: string; byKind: Record<string, string> };
  final: { trapsCaught: string; cleanPaid: string };
  guardBlocks: number;
  manipulationFlagged: number;
  costPerInvoiceUsd: number;
  avgLatencyMs: number;
}

export interface ProofData {
  eval: { cases: number; ranAt: string; summary: Record<string, ModeScore> } | null;
  consistency: {
    probes: number;
    runs: number;
    flips: { serv: number; rawSmall: number; rawBig: number };
    rows: { title: string; serv: Verdict[]; rawSmall: Verdict[]; rawBig: Verdict[] }[];
  } | null;
  gapCount: number;
  clauseCount: number;
}

export function loadProof(): ProofData {
  const dir = evalDir();
  const latest = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().at(-1) : undefined;
  const raw = latest ? JSON.parse(readFileSync(join(dir, latest), "utf8")) : null;
  const s = new Store(dbPath(), { readOnly: isDemo() });
  const gaps = s.latestReport<{ results: { gap: string[] }[]; policyVersion: number }>("gaps");
  return {
    eval: raw ? { cases: raw.cases, ranAt: latest!.slice(0, 10), summary: raw.summary } : null,
    consistency: s.latestReport<ProofData["consistency"]>("consistency"),
    gapCount: gaps?.results.filter((r) => r.gap.length).length ?? 0,
    clauseCount: (gaps && s.policy(gaps.policyVersion)?.clauses.length) ?? 0,
  };
}
