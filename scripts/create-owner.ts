import "dotenv/config";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { normalizeEmail } from "@/services/auth";

// Creates the first owner account on a fresh database:
//   npm run create-owner -- --name "Aarif" --email aarif@hidigital.co.in
// Prints a one-time temporary password; it is not stored anywhere in plain text.
function arg(flag: string) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name");
  const emailArg = arg("--email");
  if (!name || !emailArg) {
    console.error('Usage: npm run create-owner -- --name "Full Name" --email you@example.com');
    process.exit(1);
  }
  const email = normalizeEmail(emailArg);
  if (await db.user.findUnique({ where: { email } })) {
    console.error(`An account for ${email} already exists. Use the Team page to reset its password.`);
    process.exit(1);
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, role: "OWNER", passwordHash, mustChangePassword: true } });
    await writeAudit(tx, { actorId: null, action: "user.created", entityType: "User", entityId: user.id, after: { name, email, role: "OWNER", via: "create-owner script" } });
  });
  console.log(`Owner created: ${name} <${email}>`);
  console.log(`Temporary password (shown once): ${temporaryPassword}`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
