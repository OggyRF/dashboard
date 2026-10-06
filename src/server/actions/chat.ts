"use server";

import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { channelView, deleteMessage, editMessage, postMessage, toggleReaction, type ChannelView } from "@/services/chat";
import { errorMessage } from "./helpers";

// The chat screen talks to these directly and re-reads the channel after each
// change, so nothing needs revalidating.

export async function loadChannelAction(channelId: string, threadId: string | null): Promise<ChannelView | null> {
  const user = await requireUser();
  try {
    return await channelView(user, channelId, threadId);
  } catch {
    return null;
  }
}

// Fields: channelId, body, parentId (thread), replyToId (quoted message),
// image (repeated; pictures already shrunk in the browser) with imageWidth and
// imageHeight alongside each.
export async function sendChatAction(form: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v ? v : null;
  };
  try {
    const files = form.getAll("image").filter((f): f is File => f instanceof Blob);
    const widths = form.getAll("imageWidth").map(Number);
    const heights = form.getAll("imageHeight").map(Number);
    const images = await Promise.all(files.map(async (f, i) => ({ bytes: new Uint8Array(await f.arrayBuffer()), width: widths[i], height: heights[i] })));
    await postMessage(user, String(form.get("channelId") ?? ""), text("body") ?? "", text("parentId"), new Date(), { replyToId: text("replyToId"), images });
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function editChatAction(messageId: string, body: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await editMessage(user, messageId, body);
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteChatAction(messageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await deleteMessage(user, messageId, (await requestMeta()).ip);
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function reactChatAction(messageId: string, emoji: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await toggleReaction(user, messageId, emoji);
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
