import { cookies } from "next/headers";
import { getCurrentUser, requestMeta } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { GoogleError, exchangeCode } from "@/lib/google/api";
import { saveConnection } from "@/services/google";
import { STATE_COOKIE, callbackUrl, sameState } from "../redirect";

// Google sends the owner back here after the consent screen.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => Response.redirect(new URL(`/settings/google?${query}`, request.url));
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", request.url));
  if (!can(user.role, "google.connect")) return new Response("Not allowed", { status: 403 });

  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value ?? "";
  store.delete({ name: STATE_COOKIE, path: "/api/google" });
  if (!sameState(url.searchParams.get("state") ?? "", expected)) return back("error=state");
  if (url.searchParams.get("error")) return back("error=denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error=denied");

  try {
    const { refreshToken, email } = await exchangeCode(code, callbackUrl(request));
    await saveConnection(user, email, refreshToken, (await requestMeta()).ip);
  } catch (e) {
    if (e instanceof GoogleError) return back(`error=google&message=${encodeURIComponent(e.message.slice(0, 200))}`);
    throw e;
  }
  return back("connected=1");
}
