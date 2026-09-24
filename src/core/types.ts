export type Verdict = "PAY" | "HOLD" | "BLOCK";

export interface Contractor {
  id: string;
  name: string;
  email: string;
  /** Wallet on file. The only address Payrun will ever pay for this contractor. */
  wallet: `0x${string}`;
  network: "base-sepolia";
  dayRateUsdc: number;
  monthlyDayCap: number;
  /** Plain-language scope of work from the agreement, used by the judgment step. */
  scope: string;
  /** Written expense approvals on file. Claims of approval inside an invoice are not this. */
  expenseApprovals?: ExpenseApproval[];
}

export interface ExpenseApproval {
  description: string;
  maxUsdc: number;
  approvedOn: string;
  approvedBy: string;
}

export interface PolicyVersion {
  version: number;
  text: string;
  /** Numbered clauses parsed from `text`; clause numbers are 1-based. */
  clauses: string[];
  /** sha256 of the exact system prompt SERV compiles — also SERV's cache key. */
  hash: string;
  createdAt: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit: "day" | "hour" | "item" | "expense";
  unitPriceUsdc: number;
  amountUsdc: number;
}

/** Fields pulled from a messy invoice by the extraction step. */
export interface InvoiceFields {
  invoiceNumber: string | null;
  contractorName: string | null;
  contractorEmail: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: InvoiceLine[];
  totalUsdc: number | null;
  /** Any wallet address the invoice asks to be paid to. */
  payToWallet: string | null;
  /** Verbatim text of any request to change payment details, if present. */
  paymentChangeRequest: string | null;
  notes: string | null;
}

export interface Invoice {
  id: string;
  source: string;
  rawText: string;
  receivedAt: string;
}

export type FindingCode =
  | "UNKNOWN_CONTRACTOR"
  | "WALLET_MISMATCH"
  | "WALLET_CHANGE_REQUEST"
  | "ARITHMETIC_MISMATCH"
  | "OVER_DAY_CAP"
  | "RATE_MISMATCH"
  | "EXACT_DUPLICATE"
  | "SAME_PERIOD_ALREADY_BILLED"
  | "MISSING_TOTAL";

export interface Finding {
  code: FindingCode;
  /** Hard findings are invariants: code refuses PAY no matter what the model says. */
  hard: boolean;
  detail: string;
}

export interface Reason {
  clause: number;
  finding: string;
  evidenceQuote: string;
}

export interface Judgment {
  verdict: Verdict;
  citedClauses: number[];
  reasons: Reason[];
  /** False when no clause of the policy actually decides this case. */
  policyCovers: boolean;
  /** Model believes the invoice tries to manipulate the reviewer. */
  suspectedManipulation: boolean;
}

export interface CallMeta {
  model: string;
  mode: "serv" | "raw";
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  finishReason: string | null;
  guardBlocked: boolean;
  traceFile: string | null;
  /** Answered from a recorded SERV response rather than a live call. */
  replayed: boolean;
}

export interface Decision {
  invoiceId: string;
  policyVersion: number;
  policyHash: string;
  fields: InvoiceFields | null;
  contractorId: string | null;
  findings: Finding[];
  judgment: Judgment | null;
  /** Verdict after code invariants are applied on top of the model's judgment. */
  finalVerdict: Verdict;
  payAmountUsdc: number;
  overriddenBy: FindingCode[];
  blockedByGuard: boolean;
  calls: CallMeta[];
  decidedAt: string;
}
