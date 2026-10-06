import type { Responsibility } from "@/generated/prisma/enums";

// Shared with forms in the browser, so kept apart from the client service.
export const RESPONSIBILITY_LABELS: Record<Responsibility, string> = {
  STRATEGY: "SEO Strategist",
  EXECUTION: "SEO Project Manager",
  OFFPAGE: "Off-Page SEO Specialist",
  // No longer offered; kept so older team rows still have a name.
  QA: "QA",
};
