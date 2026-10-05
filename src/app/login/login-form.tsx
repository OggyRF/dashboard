"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email} className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
