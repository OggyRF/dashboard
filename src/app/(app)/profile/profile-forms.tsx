"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Camera, Trash2 } from "lucide-react";
import { removeAvatarAction, updateEmailAction, updateNameAction, uploadAvatarAction } from "@/server/actions/profile";
import type { ActionResult } from "@/server/actions/helpers";

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateNameAction, undefined);
  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <label htmlFor="name" className="label">Your name</label>
        <input id="name" name="name" defaultValue={name} required minLength={2} maxLength={80} className="field" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save name"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updateEmailAction, undefined);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div>
        <label htmlFor="email" className="label">Login email</label>
        <input id="email" name="email" type="email" defaultValue={email} required className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Your password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save email"}</button>
      <div className="sm:col-span-3"><Feedback state={state} /></div>
    </form>
  );
}

// Crops the chosen picture to a centred square and shrinks it to 256px
// before upload, so photos stay small whatever the phone camera produces.
async function squareJpeg(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("resize failed"))), "image/jpeg", 0.85));
}

export function PhotoForm({ hasPhoto }: { hasPhoto: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ActionResult>(undefined);
  const [pending, startTransition] = useTransition();

  function chosen(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("photo", await squareJpeg(file), "photo.jpg");
        setState(await uploadAvatarAction(undefined, data));
      } catch {
        setState({ error: "That file could not be read as a picture." });
      }
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => chosen(e.target.files?.[0])} />
      <button type="button" disabled={pending} onClick={() => input.current?.click()} className="btn-secondary">
        <Camera className="h-4 w-4" />
        {pending ? "Uploading…" : hasPhoto ? "Change photo" : "Add photo"}
      </button>
      {hasPhoto && (
        <button type="button" disabled={pending} onClick={() => startTransition(async () => setState(await removeAvatarAction()))} className="btn-danger">
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      )}
      <Feedback state={state} />
    </div>
  );
}

function Feedback({ state }: { state: ActionResult }) {
  if (state?.error) return <p role="alert" className="w-full text-sm text-danger">{state.error}</p>;
  if (state?.ok) return <p className="w-full text-sm text-success">{state.ok}</p>;
  return null;
}
