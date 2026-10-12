/**
 * Settings' Site and Deploy hooks sections, for admins.
 *
 * Site is the site's own name and address, which Studio shows and agents can
 * read. A deploy hook is a URL called after every publish: a host's build
 * hook to rebuild a static site, or the site's revalidate route to refresh
 * cached pages. Each hook shows what it answered last, so "did the site hear
 * about that publish?" has an answer here.
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { DeployHookDto, SiteDto } from "../../editor-types";
import { IconTrash } from "../components/icons";
import { Row } from "../components/set-row";
import { useConfirm } from "../components/ui/confirm";
import { api, plainError } from "../lib/api";
import { absoluteTime, relativeTime } from "../lib/format";
import type { Resource } from "../lib/use-resource";

export function SitePanel({ site }: { site: Resource<SiteDto> }) {
  const [busy, setBusy] = useState(false);
  const settings = site.data?.settings;

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    api("/site", {
      method: "PUT",
      body: JSON.stringify({ name: data.get("name"), url: data.get("url") }),
    })
      .then(() => {
        toast.success("Site settings saved");
        site.refresh();
      })
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="set-panel">
      {/* Keyed on what loaded, so the inputs start from the saved values. */}
      <form key={`${settings?.name}|${settings?.url}`} className="site-form" onSubmit={submit}>
        <Row label="Name" hint="What the site is called, in Studio and to agents.">
          <input
            className="input"
            name="name"
            defaultValue={settings?.name ?? ""}
            aria-label="Site name"
            maxLength={120}
          />
        </Row>
        <Row label="Address" hint="Where the site is online. Links to entries start here.">
          <input
            className="input"
            name="url"
            type="url"
            placeholder="https://example.com"
            defaultValue={settings?.url ?? ""}
            aria-label="Site address"
          />
        </Row>
        <div className="set-actions">
          <button
            type="submit"
            className="btn"
            data-variant="primary"
            disabled={busy || !site.data}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function HooksPanel({ site }: { site: Resource<SiteDto> }) {
  const hooks = site.data?.hooks ?? [];
  return (
    <div className="set-panel">
      {hooks.map((hook) => (
        <HookRow key={hook.id} hook={hook} onChanged={site.refresh} />
      ))}
      {site.data && hooks.length === 0 ? (
        <Row
          label="No deploy hooks"
          hint="Add one if the site needs telling after a publish: a host's build hook, or the site's revalidate route."
        />
      ) : null}
      <NewHook onAdded={site.refresh} />
    </div>
  );
}

function lastCall(hook: DeployHookDto): string {
  if (!hook.lastAt) return "Not called yet";
  const when = relativeTime(hook.lastAt);
  if (hook.lastError) {
    return `Failed ${when}${hook.lastStatus ? ` (${hook.lastStatus})` : ""}: ${hook.lastError}`;
  }
  return `Answered ${hook.lastStatus ?? "OK"} ${when}`;
}

function HookRow({ hook, onChanged }: { hook: DeployHookDto; onChanged: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const test = (): void => {
    setBusy(true);
    api<{ status: number | null; error: string | null }>(`/site/hooks/${hook.id}/test`, {
      method: "POST",
      body: "{}",
    })
      .then((result) =>
        result.error
          ? toast.error(`${hook.name} didn't take it: ${result.error}`)
          : toast.success(`${hook.name} answered ${result.status}`),
      )
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      kind: "delete",
      title: `Remove the ${hook.name} hook?`,
      body: "It isn't called after publishes any more. Add it again to bring it back.",
      action: "Remove hook",
    });
    if (!ok) return;
    setBusy(true);
    api(`/site/hooks/${hook.id}`, { method: "DELETE" })
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  return (
    <Row label={hook.name} hint={`${hook.url}${hook.hasSecret ? " · sends a secret" : ""}`}>
      <span
        className="hook-last"
        data-tone={hook.lastError ? "error" : undefined}
        title={hook.lastAt ? absoluteTime(hook.lastAt) : undefined}
      >
        {lastCall(hook)}
      </span>
      <button type="button" className="btn" data-size="sm" disabled={busy} onClick={test}>
        Send a test
      </button>
      <button
        type="button"
        className="btn"
        data-size="icon"
        data-variant="ghost"
        aria-label={`Remove ${hook.name}`}
        disabled={busy}
        onClick={() => void remove()}
      >
        <IconTrash size={14} />
      </button>
    </Row>
  );
}

function NewHook({ onAdded }: { onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setProblem(null);
    api("/site/hooks", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        url: data.get("url"),
        secret: data.get("secret") || null,
      }),
    })
      .then(() => {
        form.reset();
        onAdded();
      })
      .catch((error: unknown) => setProblem(plainError(error)))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      label="Add a hook"
      hint="Called with a POST after every publish. Add a secret if the URL checks one; it's sent as a bearer header."
      stack
    >
      <form className="hook-form" onSubmit={submit}>
        <input
          className="input"
          name="name"
          placeholder="Name, e.g. Rebuild"
          aria-label="Name"
          required
        />
        <input
          className="input"
          name="url"
          type="url"
          placeholder="https://"
          aria-label="URL"
          required
        />
        <input
          className="input"
          name="secret"
          type="password"
          placeholder="Secret (optional)"
          aria-label="Secret"
          autoComplete="off"
        />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Adding…" : "Add hook"}
        </button>
      </form>
      {problem ? (
        <p className="notice" data-tone="error" role="alert">
          {problem}
        </p>
      ) : null}
    </Row>
  );
}
