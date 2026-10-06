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

export async function sendChatAction(channelId: string, body: string, parentId: string | null): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await postMessage(user, channelId, body, parentId);
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
