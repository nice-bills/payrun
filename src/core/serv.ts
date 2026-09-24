import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CallMeta } from "./types";

/** USD per million tokens, from docs.openserv.ai/serv-reasoning/models (SERV prices include reasoning). */
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-5.4-nano": { in: 0.25, out: 1.6 },
  "gpt-5.4-mini": { in: 1.0, out: 6.0 },
  "gpt-5.4": { in: 3.25, out: 20.0 },
  "gpt-5.6-luna": { in: 0.25, out: 1.5 },
  "gpt-6-luna": { in: 0.13, out: 0.65 },
  "gpt-6-sol": { in: 2.6, out: 13.0 },
  "claude-haiku-4.5": { in: 1.25, out: 6.5 },
};

export type ServFeature = "kronos" | "multipath";

/** An application tool: a function our code runs when the model calls it. SERV forwards these to the model unchanged. */
export interface AppTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as the model wrote them; parse and validate before acting. */
  arguments: string;
}

/** Turns after the first user message: the model's tool calls and our tool results. */
export type ChatTurn =
  | { role: "assistant"; content: string | null; tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ServCall {
  /** Base catalog model id, e.g. "gpt-5.4-nano". Feature suffixes are added here. */
  model: string;
  features?: ServFeature[];
  system: string;
  user: string;
  /** Strict JSON schema for the response. */
  schema?: { name: string; schema: Record<string, unknown> };
  /** Arm serv_prompt_guard: SERV screens the user-controlled context before the model runs. */
  guard?: boolean;
  /** Arm serv_shadow_agent with a task-specific validation hint. */
  shadow?: { hint: string; maxIterations?: number };
  /** Bypass SERV entirely (x-openserv-disable-braid) for a controlled comparison. */
  raw?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
  /** Caps output; also lowers SERV's pre-flight cost ceiling for the request. */
  maxCompletionTokens?: number;
  /** Force SERV to regenerate the reasoning prompt instead of using its cache. */
  noCache?: boolean;
  /** Application tools the model may call (alongside SERV's own marker tools). */
  appTools?: AppTool[];
  toolChoice?: "auto" | "required";
  /** The conversation so far after the first user message (tool calls and results). */
  turns?: ChatTurn[];
  /** Used to name the trace file. */
  label: string;
  /**
   * Distinguishes deliberately repeated identical requests (e.g. the gap finder
   * judging one probe three times) so the cassette records each one separately.
   */
  variant?: string;
}

/**
 * off     — always call SERV.
 * record  — call SERV and save every response.
 * replay  — never call SERV; fail if a response was not recorded.
 * auto    — replay when recorded, otherwise call SERV and record.
 */
export type CassetteMode = "off" | "record" | "replay" | "auto";

export interface ServResult<T = unknown> {
  content: string;
  toolCalls: ToolCall[];
  parsed: T | null;
  meta: CallMeta;
  response: unknown;
  /** SERV-specific response headers (x-openserv-*), if any. */
  servHeaders: Record<string, string>;
}

export interface ServClientOptions {
  apiKey?: string;
  baseUrl?: string;
  traceDir?: string | null;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  cassetteMode?: CassetteMode;
  cassetteDir?: string;
}

export function modelId(model: string, features: ServFeature[] = [], raw = false): string {
  if (raw || features.length === 0) return model;
  const order: ServFeature[] = ["kronos", "multipath"];
  return `${model}-serv-${order.filter((f) => features.includes(f)).join("-")}`;
}

/**
 * What one SERV request actually costs, from the console (24 Sep 2026: $0.26 over
 * 32 requests). Returned token counts exclude SERV's own feature calls, so for
 * SERV-mode requests this calibrated figure is used instead of tokens × price.
 */
export function servCostPerRequest(): number {
  const v = Number(process.env.SERV_COST_PER_REQUEST_USD ?? "0.0081");
  return Number.isFinite(v) && v >= 0 ? v : 0.0081;
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

/**
 * Prompt Guard blocks before the upstream model runs, so a guard refusal is the
 * only response with zero tokens billed. Observed shapes (spike, 2026-09-24):
 *   { content: null, refusal: "I can't share that." }, finish_reason "stop"
 *   { content: "I can't share that." },                finish_reason "content_filter"
 * A refusal the model itself produces has non-zero usage and is not a guard block.
 */
export function looksLikeGuardRefusal(choice: any, usage: any): boolean {
  if (!choice) return false;
  const modelRan = (usage?.prompt_tokens ?? 0) > 0 || (usage?.completion_tokens ?? 0) > 0;
  if (modelRan) return false;
  return choice.finish_reason === "content_filter" || !!choice.message?.refusal;
}

export class ServClient {
  private apiKey: string;
  private baseUrl: string;
  private traceDir: string | null;
  private fetchImpl: typeof fetch;
  private maxRetries: number;
  private cassetteMode: CassetteMode;
  private cassetteDir: string;
  /** Requests answered from the cassette vs sent to SERV in this process. */
  readonly stats = { replayed: 0, live: 0 };

  constructor(opts: ServClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.SERV_API_KEY ?? "";
    this.baseUrl = opts.baseUrl ?? process.env.SERV_BASE_URL ?? "https://inference-api.openserv.ai/v1";
    this.traceDir = opts.traceDir === undefined ? "data/traces" : opts.traceDir;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 2;
    this.cassetteMode = opts.cassetteMode ?? ((process.env.PAYRUN_SERV_CASSETTE as CassetteMode) || "off");
    this.cassetteDir = opts.cassetteDir ?? process.env.PAYRUN_CASSETTE_DIR ?? "fixtures/cassettes";
  }

  async call<T = unknown>(c: ServCall): Promise<ServResult<T>> {
    const model = modelId(c.model, c.features, c.raw);
    const tools: unknown[] = [];
    if (!c.raw && c.guard) tools.push({ type: "function", function: { name: "serv_prompt_guard" } });
    if (!c.raw && c.shadow) {
      tools.push({
        type: "function",
        function: {
          name: "serv_shadow_agent",
          parameters: {
            type: "object",
            properties: {
              hint: { type: "string", default: c.shadow.hint },
              max_iterations: { type: "integer", default: c.shadow.maxIterations ?? 3 },
            },
          },
        },
      });
    }
    for (const t of c.appTools ?? []) tools.push({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters, strict: true } });
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: c.system },
        { role: "user", content: c.user },
        ...(c.turns ?? []),
      ],
    };
    if (tools.length) body.tools = tools;
    if (c.appTools?.length) {
      body.tool_choice = c.toolChoice ?? "auto";
      // One action at a time: every side effect gets its own result before the next decision.
      body.parallel_tool_calls = false;
    }
    if (c.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: c.schema.name, strict: true, schema: c.schema.schema },
      };
    }
    if (c.reasoningEffort) body.reasoning_effort = c.reasoningEffort;
    if (c.maxCompletionTokens) body.max_completion_tokens = c.maxCompletionTokens;
    if (c.noCache && !c.raw) body.metadata = { prompt_cache: "disabled" };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (c.raw) headers["x-openserv-disable-braid"] = "true";

    const key = createHash("sha256").update(JSON.stringify({ raw: !!c.raw, body, variant: c.variant ?? "" })).digest("hex").slice(0, 32);
    const cassetteFile = join(this.cassetteDir, `${key}.json`);
    let json: any;
    let servHeaders: Record<string, string>;
    let latencyMs: number;
    let replayed = false;
    const canReplay = (this.cassetteMode === "replay" || this.cassetteMode === "auto") && existsSync(cassetteFile);
    if (canReplay) {
      ({ json, servHeaders, latencyMs } = JSON.parse(readFileSync(cassetteFile, "utf8")));
      replayed = true;
      this.stats.replayed++;
    } else {
      if (this.cassetteMode === "replay") throw new Error(`No recorded SERV response for ${c.label} (${key}); run with PAYRUN_SERV_CASSETTE=auto to record it`);
      if (!this.apiKey) throw new Error("SERV_API_KEY is not set");
      const started = Date.now();
      ({ json, servHeaders } = await this.post(`${this.baseUrl}/chat/completions`, headers, body));
      latencyMs = Date.now() - started;
      this.stats.live++;
      if (this.cassetteMode === "record" || this.cassetteMode === "auto") {
        mkdirSync(this.cassetteDir, { recursive: true });
        writeFileSync(cassetteFile, JSON.stringify({ label: c.label, model, raw: !!c.raw, recordedAt: new Date().toISOString(), latencyMs, servHeaders, json }, null, 2));
      }
    }

    const choice = json?.choices?.[0];
    const content: string = choice?.message?.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter((t: any) => t?.function?.name)
      .map((t: any) => ({ id: String(t.id), name: String(t.function.name), arguments: String(t.function.arguments ?? "{}") }));
    const guardBlocked = !c.raw && !!c.guard && looksLikeGuardRefusal(choice, json?.usage);
    let parsed: T | null = null;
    if (c.schema && !guardBlocked) {
      try {
        parsed = JSON.parse(content) as T;
      } catch {
        parsed = null;
      }
    }
    const promptTokens = json?.usage?.prompt_tokens ?? 0;
    const completionTokens = json?.usage?.completion_tokens ?? 0;
    const traceFile = replayed ? null : this.trace(c.label, { model, raw: !!c.raw, body, latencyMs, servHeaders, response: json });

    return {
      content,
      toolCalls,
      parsed,
      response: json,
      servHeaders,
      meta: {
        model,
        mode: c.raw ? "raw" : "serv",
        latencyMs,
        promptTokens,
        completionTokens,
        costUsd: c.raw ? estimateCost(c.model, promptTokens, completionTokens) : servCostPerRequest(),
        finishReason: choice?.finish_reason ?? null,
        guardBlocked,
        traceFile,
        replayed,
      },
    };
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<{ json: any; servHeaders: Record<string, string> }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      let text: string;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
        text = await res.text();
      } catch (e) {
        // Network failures happen on slow cache-miss compiles; retry them like 5xx.
        lastError = e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (res.ok) {
        const servHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          if (k.startsWith("x-openserv") || k.startsWith("x-serv")) servHeaders[k] = v;
        });
        return { json: JSON.parse(text), servHeaders };
      }
      lastError = new Error(`SERV ${res.status}: ${text.slice(0, 500)}`);
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    throw lastError;
  }

  private trace(label: string, data: unknown): string | null {
    if (!this.traceDir) return null;
    mkdirSync(this.traceDir, { recursive: true });
    const file = join(this.traceDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
  }
}
