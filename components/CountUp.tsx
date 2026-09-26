"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** A number that counts up the first time it scrolls into view, and to each new value after that. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-US"), duration = 1.1 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) return void setShown((from.current = value));
    const c = animate(from.current, value, {
      duration,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => setShown((from.current = v)),
    });
    return () => c.stop();
  }, [inView, value, reduce, duration]);
  return (
    <span ref={ref} className="tabular-nums">
      {format(shown)}
    </span>
  );
}
