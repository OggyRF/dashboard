"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requestMeta, requireUser } from "@/lib/auth/current-user";
import { addTaskComment, changeTaskStatus, createTask, updateTask, type TaskAction } from "@/services/tasks";
import { errorMessage, type ActionResult } from "./helpers";

function taskFields(f: FormData) {
  const get = (k: string) => (f.get(k) === null ? undefined : String(f.get(k)));
  return {
    clientId: get("clientId"),
    title: get("title"),
    description: get("description"),
    category: get("category"),
    priority: get("priority"),
    assigneeId: get("assigneeId"),
    reviewerId: get("reviewerId"),
    dueDate: get("dueDate"),
    sourceMessageId: get("sourceMessageId"),
  };
}

export async function createTaskAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  let number: number;
  try {
    number = (await createTask(user, taskFields(f), (await requestMeta()).ip)).number;
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/tasks");
  redirect(`/tasks/${number}`);
}

export async function updateTaskAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const number = Number(f.get("number"));
  try {
    await updateTask(user, number, taskFields(f), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/tasks/${number}`);
  return { ok: "Saved." };
}

export async function taskStepAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const number = Number(f.get("number"));
  try {
    await changeTaskStatus(user, number, String(f.get("step")) as TaskAction, String(f.get("note") ?? ""), (await requestMeta()).ip);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath("/tasks", "layout");
  revalidatePath("/clients", "layout");
  return { ok: "Updated." };
}

export async function taskCommentAction(_s: ActionResult, f: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const number = Number(f.get("number"));
  try {
    await addTaskComment(user, number, f.get("body"));
  } catch (e) {
    return { error: errorMessage(e) };
  }
  revalidatePath(`/tasks/${number}`);
  return { ok: "Posted." };
}
