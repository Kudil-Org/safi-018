import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface LoginProps {
  supabase: SupabaseClient;
}

export function Login({ supabase }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <p className="eyebrow">SAFI Platform v0.1</p>
        <h1 id="login-title">Meeting follow-up pilot</h1>
        <p className="login-copy">
          Sign in with the test account supplied by SAFI. The Assistant, checklist and booking
          records are private to this account.
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="login-footnote">
          Accounts are provisioned in Supabase. If sign-in fails, contact the SAFI operator.
        </p>
      </section>
    </main>
  );
}
