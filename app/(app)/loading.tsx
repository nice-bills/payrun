/** While a page's data loads: pinned blanks and a paper sheet with shimmering lines, in the real layout. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto grid h-full max-w-[1520px] grid-cols-1 gap-6 px-4 pt-9 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)_minmax(320px,380px)]">
      <div className="hidden flex-col gap-5 lg:flex">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex h-[74px] flex-col justify-center gap-2 rounded-[3px] bg-paper px-4 shadow-[var(--shadow-card)]">
            <div className="skeleton h-3 w-2/3 rounded-[2px]" />
            <div className="skeleton h-2.5 w-1/3 rounded-[2px]" />
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-[760px] rounded-[3px] bg-paper p-10 shadow-[var(--shadow-paper)]">
        {[70, 45, 0, 60, 80, 52, 0, 90, 40].map((w, i) =>
          w ? <div key={i} className="skeleton mb-4 h-3 rounded-[2px]" style={{ width: `${w}%` }} /> : <div key={i} className="h-5" />,
        )}
      </div>
      <div className="legal-pad hidden rounded-t-[3px] p-8 shadow-[var(--shadow-paper)] lg:block">
        <div className="skeleton h-8 w-3/4 rounded-[2px]" />
      </div>
    </div>
  );
}
