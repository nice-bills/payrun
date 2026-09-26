/** What going live recorded about SERV compiling a version's graphs (see warm.ts). Kept apart so pages can read it without loading the agent. */
export interface WarmGraph {
  name: "review" | "agent";
  ms: number;
  requestId: string | null;
  /** Answered fast enough that the graph was already compiled. */
  cached: boolean;
}

export interface WarmReport {
  version: number;
  hash: string;
  graphs: WarmGraph[];
  at: string;
}

export const warmKey = (version: number) => `serv_warm_v${version}`;
