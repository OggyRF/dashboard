import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/tokens";

// Optimistic check only: sends visitors without a session cookie to the login
// page. Real session validation happens on the server for every page and action.
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|team-login|api/health|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
