"use client";

import { useActionState } from "react";
import { setupAction } from "@/server/actions/auth";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="label">Your name</label>
        <input id="name" name="name" autoComplete="name" required className="field" />
      </div>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email} className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required className="field" />
      </div>
      <div>
        <label htmlFor="confirm" className="label">Repeat password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="field" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? "Creating…" : "Create account and sign in"}
      </button>
    </form>
  );
}
