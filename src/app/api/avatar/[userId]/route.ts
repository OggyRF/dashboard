import { getCurrentUser } from "@/lib/auth/current-user";
import { AppError } from "@/lib/errors";
import { getAvatar } from "@/services/profile";

// Profile photos, for signed-in people only. URLs carry ?v=<version>, so the
// browser can keep a photo until it changes.
export async function GET(_request: Request, ctx: RouteContext<"/api/avatar/[userId]">) {
  const viewer = await getCurrentUser();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  const { userId } = await ctx.params;
  try {
    const avatar = await getAvatar(viewer, userId);
    return new Response(new Uint8Array(avatar.data), {
      headers: {
        "Content-Type": avatar.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
