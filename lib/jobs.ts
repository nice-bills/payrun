import "server-only";

/**
 * Slow SERV work (finding holes takes minutes) runs as a background job in the
 * server process; the page polls its progress instead of waiting on one request.
 * In-memory is enough for a single local server and the hosted replay demo.
 */
export interface Job {
  id: string;
  kind: string;
  status: "running" | "done" | "failed";
  progress: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const jobs = (globalThis as unknown as { __payrunJobs?: Map<string, Job> }).__payrunJobs ?? new Map<string, Job>();
(globalThis as unknown as { __payrunJobs?: Map<string, Job> }).__payrunJobs = jobs;

export function startJob(kind: string, work: (log: (msg: string) => void) => Promise<void>): Job {
  const running = [...jobs.values()].find((j) => j.kind === kind && j.status === "running");
  if (running) return running;
  const job: Job = { id: `${kind}-${Date.now()}`, kind, status: "running", progress: [], error: null, startedAt: new Date().toISOString(), finishedAt: null };
  jobs.set(job.id, job);
  void work((msg) => job.progress.push(msg))
    .then(() => {
      job.status = "done";
    })
    .catch((e) => {
      job.status = "failed";
      const msg = e instanceof Error ? e.message : String(e);
      job.error = msg.includes("402") ? "Out of SERV credit." : msg.slice(0, 240);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

export function latestJob(kind: string): Job | null {
  return [...jobs.values()].filter((j) => j.kind === kind).at(-1) ?? null;
}
