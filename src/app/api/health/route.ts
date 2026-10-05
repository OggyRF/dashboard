import { db } from "@/lib/db";

// Used by the uptime monitor and the Docker health check.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "database_unreachable" }, { status: 503 });
  }
}
