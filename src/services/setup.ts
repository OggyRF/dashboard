import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { conflict, invalid } from "@/lib/errors";
import { normalizeEmail } from "@/services/auth";

// First-run setup: on an empty database the first visitor creates the first
// owner account. Once any account exists this is closed for good; further
// people are added from the Team page.

export const firstOwnerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.email("Enter a valid email address.").transform(normalizeEmail),
  password: z.string().max(200),
});

export async function needsSetup() {
  return (await db.user.count()) === 0;
}

export async function createFirstOwner(input: z.input<typeof firstOwnerSchema>) {
  const parsed = firstOwnerSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Check the form.");
  const { name, email, password } = parsed.data;
  const problem = passwordProblem(password);
  if (problem) throw invalid(problem);
  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    // Serialises concurrent attempts so only one first owner can ever be made.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    if ((await tx.user.count()) > 0) throw conflict("Setup is already done. Sign in instead.");
    const user = await tx.user.create({ data: { name, email, role: "OWNER", passwordHash, mustChangePassword: false } });
    await writeAudit(tx, { actorId: null, action: "user.created", entityType: "User", entityId: user.id, after: { name, email, role: "OWNER", via: "first-run setup" } });
    return user;
  });
}
