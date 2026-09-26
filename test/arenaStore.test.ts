import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ArenaLog, type Attempt } from "../src/core/arena";
import { RedisListStore, redisFromEnv } from "../src/core/arenaStore";
import { fakeUpstash } from "../scripts/demo/kit";

const attempt = (id: string, at: string): Attempt => ({
  id, at, handle: null, wallet: "0x2222222222222222222222222222222222222222", verdict: "BLOCK", caughtBy: "SERV",
  clauses: [3], reason: "r", paidUsdc: 0, txHash: null, servRequests: 2, steps: [],
});

describe("durable arena board", async () => {
  const redis = await fakeUpstash();
  afterAll(() => redis.close());

  it("mirrors every attempt and restores them into a fresh container, in time order, without duplicates", async () => {
    const store = new RedisListStore(redis.url, redis.token, fetch, "t1");
    const file = join(mkdtempSync(join(tmpdir(), "arena-")), "a.json");
    const a = new ArenaLog(file, store);
    await a.add(attempt("x", "2026-09-26T10:00:00Z"));
    await a.add(attempt("y", "2026-09-26T11:00:00Z"));
    rmSync(file);
    const b = new ArenaLog(file, store);
    await b.add(attempt("z", "2026-09-26T12:00:00Z")); // taken before the restore finished
    expect(await b.restore()).toBe(2);
    expect(await b.restore()).toBe(0);
    expect(b.all().map((x) => x.id)).toEqual(["x", "y", "z"]);
  });

  it("keeps the local copy when the store is down", async () => {
    const down = new RedisListStore("http://127.0.0.1:1", "t", fetch, "t2");
    const file = join(mkdtempSync(join(tmpdir(), "arena-")), "a.json");
    const log = new ArenaLog(file, down);
    await log.add(attempt("x", "2026-09-26T10:00:00Z"));
    expect(log.all()).toHaveLength(1);
  });

  it("reads Upstash or Vercel KV settings, and nothing without both", () => {
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeInstanceOf(RedisListStore);
    expect(redisFromEnv({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" })).toBeInstanceOf(RedisListStore);
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: "https://x" })).toBeNull();
  });
});
