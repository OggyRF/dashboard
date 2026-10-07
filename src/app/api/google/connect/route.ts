import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { consentUrl, googleConfigured } from "@/lib/google/api";
import { STATE_COOKIE, callbackUrl } from "../redirect";

// Sends an owner to Google's consent screen to connect the agency account.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", request.url));
  if (!can(user.role, "google.connect")) return new Response("Not allowed", { status: 403 });
  if (!googleConfigured()) return Response.redirect(new URL("/settings/google?error=keys", request.url));
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return Response.redirect(consentUrl(callbackUrl(request), state));
}
