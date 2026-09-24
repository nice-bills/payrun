import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makePolicyVersion } from "./policy";
import type { HistoryEntry } from "./checks";
import type { PaymentResult } from "./pay";
import type { Contractor, Decision, Invoice, PolicyVersion } from "./types";

/** Small SQLite store. Rows keep their full JSON so the UI can render anything the core produced. */
export class Store {
  private db: DatabaseSync;

  constructor(path = "data/payrun.db") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // The desk reads while the CLI writes; WAL lets both proceed.
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policies (version INTEGER PRIMARY KEY, hash TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contractors (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, policy_version INTEGER NOT NULL,
        mode TEXT NOT NULL, verdict TEXT NOT NULL, json TEXT NOT NULL, decided_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  addPolicy(text: string): PolicyVersion {
    const latest = this.latestPolicy();
    const candidate = makePolicyVersion(text, (latest?.version ?? 0) + 1);
    if (latest && latest.hash === candidate.hash) return latest;
    this.db.prepare("INSERT INTO policies (version, hash, json) VALUES (?, ?, ?)").run(candidate.version, candidate.hash, JSON.stringify(candidate));
    return candidate;
  }

  latestPolicy(): PolicyVersion | null {
    const row = this.db.prepare("SELECT json FROM policies ORDER BY version DESC LIMIT 1").get() as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  /**
   * The version invoices are decided under. New versions start as drafts: they
   * are replayed against past invoices first and only go live on purpose.
   * Without an explicit choice the first version is live.
   */
  livePolicy(): PolicyVersion | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'live_policy'").get() as { value: string } | undefined;
    return (row && this.policy(Number(row.value))) || this.policy(1) || this.latestPolicy();
  }

  setLivePolicy(version: number): void {
    if (!this.policy(version)) throw new Error(`No policy v${version}`);
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('live_policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version));
  }

  policy(version: number): PolicyVersion | null {
    const row = this.db.prepare("SELECT json FROM policies WHERE version = ?").get(version) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  policies(): PolicyVersion[] {
    return (this.db.prepare("SELECT json FROM policies ORDER BY version").all() as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  upsertContractors(list: Contractor[]): void {
    const stmt = this.db.prepare("INSERT INTO contractors (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json");
    for (const c of list) stmt.run(c.id, JSON.stringify(c));
  }

  contractors(): Contractor[] {
    return (this.db.prepare("SELECT json FROM contractors ORDER BY id").all() as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  upsertInvoice(inv: Invoice): void {
    this.db.prepare("INSERT INTO invoices (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(inv.id, JSON.stringify(inv));
  }

  invoices(): Invoice[] {
    return (this.db.prepare("SELECT json FROM invoices ORDER BY id").all() as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  addDecision(d: Decision, mode: string): void {
    this.db
      .prepare("INSERT INTO decisions (invoice_id, policy_version, mode, verdict, json, decided_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(d.invoiceId, d.policyVersion, mode, d.finalVerdict, JSON.stringify(d), d.decidedAt);
  }

  /** Latest decision per invoice for a mode (and optionally a policy version). */
  latestDecisions(mode = "serv", policyVersion?: number): Decision[] {
    const rows = this.db
      .prepare(
        `SELECT json FROM decisions d WHERE mode = ? ${policyVersion ? "AND policy_version = ?" : ""}
         AND id = (SELECT MAX(id) FROM decisions x WHERE x.invoice_id = d.invoice_id AND x.mode = d.mode ${policyVersion ? "AND x.policy_version = d.policy_version" : ""})
         ORDER BY invoice_id`,
      )
      .all(...(policyVersion ? [mode, policyVersion] : [mode])) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json));
  }

  /**
   * History for duplicate checks. With `beforeInvoiceId`, only invoices that
   * arrived earlier count (ingest order = id order), so a later reissue can
   * never make the original look like the duplicate.
   */
  history(beforeInvoiceId?: string): HistoryEntry[] {
    return this.latestDecisions("serv")
      .filter((d) => (beforeInvoiceId ? d.invoiceId < beforeInvoiceId : true) && d.contractorId && d.fields)
      .map((d) => ({
        invoiceId: d.invoiceId,
        contractorId: d.contractorId!,
        invoiceNumber: d.fields!.invoiceNumber,
        periodStart: d.fields!.periodStart,
        periodEnd: d.fields!.periodEnd,
        totalUsdc: d.fields!.totalUsdc,
        verdict: d.finalVerdict,
      }));
  }

  addPayment(p: PaymentResult): void {
    this.db.prepare("INSERT INTO payments (invoice_id, status, json) VALUES (?, ?, ?)").run(p.invoiceId, p.status, JSON.stringify(p));
  }

  payments(): PaymentResult[] {
    return (this.db.prepare("SELECT json FROM payments ORDER BY id").all() as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  paidInvoiceIds(): Set<string> {
    return new Set((this.db.prepare("SELECT invoice_id FROM payments WHERE status = 'sent'").all() as { invoice_id: string }[]).map((r) => r.invoice_id));
  }

  addReport(kind: string, data: unknown): void {
    this.db.prepare("INSERT INTO reports (kind, json, created_at) VALUES (?, ?, ?)").run(kind, JSON.stringify(data), new Date().toISOString());
  }

  reports<T>(kind: string): T[] {
    return (this.db.prepare("SELECT json FROM reports WHERE kind = ? ORDER BY id").all(kind) as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  deleteContractor(id: string): void {
    this.db.prepare("DELETE FROM contractors WHERE id = ?").run(id);
  }

  setting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  latestReport<T>(kind: string): T | null {
    const row = this.db.prepare("SELECT json FROM reports WHERE kind = ? ORDER BY id DESC LIMIT 1").get(kind) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }
}
