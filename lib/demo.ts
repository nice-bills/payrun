/**
 * Hosted demo: a read-only snapshot of real results. Nothing spends SERV
 * credit or moves money; reviewing replays the recorded verdict.
 */
export const isDemo = () => process.env.PAYRUN_DEMO === "1";

export const DEMO_MESSAGE = "This is the hosted demo: it replays recorded results and can't spend credit or move money. Clone the repo to run it live.";

export const dbPath = () => process.env.PAYRUN_DB ?? (isDemo() ? "demo/payrun.db" : "data/payrun.db");
export const evalDir = () => process.env.PAYRUN_EVAL_DIR ?? (isDemo() ? "demo/eval" : "data/eval");
