import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

// OWASP-recommended argon2id settings (19 MiB memory, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 10;

// Small deny-list of passwords people commonly pick; length does the rest.
const COMMON_PASSWORDS = new Set([
  "1234567890", "12345678910", "0987654321", "qwertyuiop", "password12",
  "password123", "password@123", "passw0rd123", "iloveyou123", "welcome123",
  "welcome@123", "admin12345", "admin@1234", "india12345", "abcd123456",
  "hidigital123", "hidigital@123", "1q2w3e4r5t", "qwerty12345", "letmein123",
]);

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Use at most 200 characters.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common. Choose another.";
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Temporary password an owner hands to a new member; they must change it on first login.
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10)}`;
}
