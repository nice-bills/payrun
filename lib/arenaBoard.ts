import "server-only";
import { ArenaLog, boardFrom, type Board } from "@/src/core/arena";
import { readSnapshot, redisFromEnv } from "@/src/core/arenaStore";

export type BoardSource = "store" | "local" | "live" | "snapshot" | "none";

export interface LoadedBoard {
  board: Board | null;
  source: BoardSource;
  /** When the board was read (for a snapshot: when it was taken). */
  asOf: string;
}

/** The OpenServ container that runs Scam Payrun serves its own board here. */
export const LIVE_BOARD_URL = process.env.ARENA_BOARD_URL ?? process.env.NEXT_PUBLIC_ARENA_BOARD_URL ?? "https://container-pd2mspsteh5k.fly.dev/arena/board";

/**
 * The board from the most durable source that answers: the Redis mirror, local
 * `arena try` runs, the live container, and last the snapshot in the repo, so
 * /arena shows real attempts even while the container is asleep or redeploying.
 */
export async function loadBoard(): Promise<LoadedBoard> {
  const now = new Date().toISOString();
  const store = redisFromEnv();
  if (store) {
    try {
      const attempts = await store.all();
      // An empty store means the container is not writing to it yet; use the other sources.
      if (attempts.length) return { board: boardFrom(attempts), source: "store", asOf: now };
    } catch {
      // fall through
    }
  }
  const local = new ArenaLog("data/arena.json").all();
  if (local.length) return { board: boardFrom(local), source: "local", asOf: now };
  const snap = readSnapshot<Board>();
  if (/^https?:\/\//.test(LIVE_BOARD_URL)) {
    try {
      const r = await fetch(LIVE_BOARD_URL, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      const live = r.ok ? ((await r.json()) as Board) : null;
      // A freshly redeployed container answers with an empty board; the snapshot knows more.
      if (live && (live.attempts.length || !snap?.attempts.length)) return { board: live, source: "live", asOf: now };
    } catch {
      // fall through
    }
  }
  if (snap) return { board: snap, source: "snapshot", asOf: snap.snapshotAt ?? now };
  return { board: null, source: "none", asOf: now };
}
