"use client";

/**
 * Posts to the typed function runtime: POST /api/fn/submitContact.
 * Success is { data }; failures are GraftError JSON whose `fix` is shown
 * verbatim — the self-teaching error surfaces all the way to the UI.
 */
import { useState } from "react";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; id: string }
  | { state: "failed"; message: string; fix?: string };

export function ContactForm() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setStatus({ state: "sending" });

    const message = String(fields.get("message") ?? "").trim();
    const res = await fetch("/api/fn/submitContact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: String(fields.get("email") ?? ""),
        ...(message ? { message } : {}),
      }),
    });
    const body = await res.json();

    if (res.ok) {
      form.reset();
      setStatus({ state: "sent", id: body.data.id });
    } else {
      setStatus({ state: "failed", message: body.message, fix: body.fix });
    }
  }

  return (
    <section className="contact">
      <h2>Say hello</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" required placeholder="you@example.com" />
        </label>
        <label>
          Message
          <textarea name="message" rows={3} placeholder="Optional" />
        </label>
        <button type="submit" disabled={status.state === "sending"}>
          {status.state === "sending" ? "Sending…" : "Send"}
        </button>
      </form>
      {status.state === "sent" ? (
        <p className="contact-note">Received — reference {status.id.slice(0, 8)}.</p>
      ) : null}
      {status.state === "failed" ? (
        <p className="contact-note contact-error">
          {status.message}
          {status.fix ? ` — ${status.fix}` : null}
        </p>
      ) : null}
    </section>
  );
}
