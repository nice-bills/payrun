import { existsSync, readFileSync } from "node:fs";
import type { Attempt } from "./arena";

/**
 * Where Scam Payrun attempts outlive the container. The OpenServ Cloud container's
 * disk goes away on a redeploy or restart, so every attempt is also pushed to a
 * Redis list over Upstash's REST API (plain fetch, no client library). Vercel's
 * KV integration sets the same thing under KV_REST_API_URL / KV_REST_API_TOKEN.
 */
export interface DurableStore {
  push(a: Attempt): Promise<void>;
  all(): Promise<Attempt[]>;
}

const KEY = process.env.ARENA_STORE_KEY ?? "payrun:arena:attempts";

export function redisFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): DurableStore | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? new RedisListStore(url, token, fetchImpl) : null;
}

export class RedisListStore implements DurableStore {
  constructor(
    private url: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
    private key = KEY,
  ) {}

  private async cmd(args: string[]): Promise<unknown> {
    const res = await this.fetchImpl(this.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || j.error) throw new Error(`Arena store ${res.status}: ${j.error ?? "request failed"}`);
    return j.result;
  }

  async push(a: Attempt): Promise<void> {
    await this.cmd(["RPUSH", this.key, JSON.stringify(a)]);
  }

  async all(): Promise<Attempt[]> {
    const rows = (await this.cmd(["LRANGE", this.key, "0", "-1"])) as string[] | null;
    return (rows ?? []).flatMap((r) => {
      try {
        return [JSON.parse(r) as Attempt];
      } catch {
        return [];
      }
    });
  }
}

/** The board as last snapshotted into the repo, so /arena never renders empty. */
export const SNAPSHOT_FILE = "demo/arena-board.json";

export function readSnapshot<T>(file = SNAPSHOT_FILE): (T & { snapshotAt?: string }) | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
