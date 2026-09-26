"use client";

import { motion, useReducedMotion } from "motion/react";
import type { Verdict } from "@/src/core/types";
import { VERDICT } from "@/lib/format";

/**
 * The rubber stamp. It only slams when `fresh` (a verdict that was just made),
 * answering "did that register?". Switching between invoices shows it instantly.
 */
export function Stamp({
  verdict,
  subline,
  fresh = false,
  size = "lg",
  delay = 0,
}: {
  verdict: Verdict;
  subline?: string;
  fresh?: boolean;
  size?: "lg" | "sm";
  /** Seconds before a fresh stamp lands, to let a list of them land one by one. */
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const v = VERDICT[verdict];
  const big = size === "lg";
  return (
    <motion.div
      role="img"
      aria-label={`${v.label}${subline ? `, ${subline}` : ""}`}
      data-verdict={verdict}
      className={`stamp pointer-events-none inline-flex select-none flex-col items-center rounded-[6px] font-sans font-black uppercase leading-none ${
        big ? "px-5 pb-2 pt-3" : "px-2 py-1"
      }`}
      style={{ rotate: big ? -8 : -6 }}
      initial={fresh && !reduce ? { scale: 1.9, opacity: 0, rotate: -18 } : false}
      animate={{ scale: 1, opacity: 1, rotate: big ? -8 : -6 }}
      transition={{ duration: 0.2, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      <span className={big ? "text-[2.6rem] tracking-[0.06em]" : "text-[0.7rem] tracking-[0.08em]"}>
        {v.word}
      </span>
      {big && subline ? <span className="mt-1.5 text-[0.62rem] font-bold tracking-[0.14em]">{subline}</span> : null}
    </motion.div>
  );
}
