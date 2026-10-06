import { getCurrentUser } from "@/lib/auth/current-user";
import { AppError } from "@/lib/errors";
import { getChatImage } from "@/services/chat";

// Pictures shared in chat, for people who can read the channel. A picture
// never changes, so the browser may keep it.
export async function GET(_request: Request, ctx: RouteContext<"/api/chat-image/[id]">) {
  const viewer = await getCurrentUser();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  try {
    const image = await getChatImage(viewer, id);
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
