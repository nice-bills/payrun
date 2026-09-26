"use client";

import { MotionConfig } from "motion/react";

/** Every motion component honours the visitor's reduce-motion setting, even ones that do not check it themselves. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
