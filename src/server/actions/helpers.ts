import { z } from "zod";
import { AppError } from "@/lib/errors";

export type ActionResult = { error?: string; ok?: string } | undefined;

// Turns expected errors into a message for the form; anything else is a bug and is rethrown.
export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form.";
  throw e;
}
