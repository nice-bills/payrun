import Link from "next/link";
import { Wordmark } from "@/components/TopBar";

/** Terms and privacy share one plain memo layout. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="cork min-h-dvh px-4 py-10 sm:px-8">
      <article className="mx-auto max-w-[720px] rounded-[3px] bg-paper px-7 py-10 shadow-[var(--shadow-paper)] sm:px-12">
        <Link href="/desk" aria-label="Back to the desk">
          <Wordmark tone="paper" />
        </Link>
        <h1 className="mt-8 text-4xl font-black tracking-[-0.04em] text-ink">{title}</h1>
        <p className="mt-2 font-type text-sm text-ink-2">Last updated {updated}</p>
        <div className="mt-8 flex flex-col gap-5 text-[1.02rem] leading-relaxed text-ink [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-black [&_h2]:tracking-[-0.02em]">{children}</div>
      </article>
    </div>
  );
}
