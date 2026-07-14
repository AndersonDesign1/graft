"use client";

/**
 * The closing CTA. The contact form is the live demo: it POSTs to the real
 * typed function runtime (submitContact), and success prints the actual
 * data_records row id — proof, not promise. GraftError `fix` text surfaces
 * verbatim on failure (the self-teaching error, all the way to the UI).
 */
import { useState } from "react";

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const cmd = "pnpm dlx graft init";
  return (
    <p className="cta-install">
      <span>
        <span className="t-prompt">$ </span>
        {cmd}
      </span>
      <button
        type="button"
        className="copy-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* clipboard denied — nothing to do */
          }
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </p>
  );
}

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; id: string }
  | { state: "failed"; message: string; fix?: string };

function LiveContactForm() {
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
    <div className="contact">
      <h3>Or say hello.</h3>
      <p className="contact-sub">
        this form is live — it calls <code>POST /api/fn/submitContact</code>, validates against
        the schema, and writes a row you can query back.
      </p>
      <form onSubmit={submit}>
        <label>
          email
          <input name="email" type="email" required placeholder="you@example.com" />
        </label>
        <label>
          message
          <textarea name="message" rows={3} placeholder="optional" />
        </label>
        <button className="button-primary" type="submit" disabled={status.state === "sending"}>
          {status.state === "sending" ? "writing row…" : "submit"}
        </button>
      </form>
      {status.state === "sent" ? (
        <p className="contact-note" aria-live="polite">
          row {status.id.slice(0, 8)} written to data_records{" "}
          <span className="dim">· validated · audit logged · rate-limited 5/min</span>
        </p>
      ) : null}
      {status.state === "failed" ? (
        <p className="contact-note contact-error" aria-live="polite">
          {status.message}
          {status.fix ? ` — ${status.fix}` : null}
        </p>
      ) : null}
    </div>
  );
}

export function ClosingCta() {
  return (
    <>
      <InstallCommand />
      <LiveContactForm />
    </>
  );
}
