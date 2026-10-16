"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { tokenView } from "@/server/token-schema";

type Token = z.infer<typeof tokenView>;

const commandMessage = {
  DELETE: "Token revoked. Its next request will fail.",
  POST: "Token created. Store its secret securely before leaving this page.",
};

function TokenSecret({ secret, hide }: { secret: string | null; hide: () => void }) {
  if (!secret) return null;
  return (
    <section className="saved-notice mt-5" aria-label="New token secret">
      <h2>Shown only once</h2>
      <p className="mt-2">
        Keep this secret out of chat, recordings, Git and tracked MCP configuration. Set it as
        SIGNAL_DESK_TOKEN in your terminal environment.
      </p>
      <code className="mt-4 block break-all select-all" data-token-secret>
        {secret}
      </code>
      <button className="quiet-button mt-4" onClick={hide}>
        I saved it securely. Hide secret.
      </button>
    </section>
  );
}

function TokenList({
  tokens,
  busy,
  revoke,
}: {
  tokens: Token[];
  busy: boolean;
  revoke: (id: string) => void;
}) {
  return (
    <section className="mt-8" aria-label="Application tokens">
      <h2>Your application tokens</h2>
      {tokens.length === 0 && (
        <p className="mt-3 text-sm text-stone-600">No application tokens yet.</p>
      )}
      <ul className="mt-4 space-y-3">
        {tokens.map((token) => (
          <li key={token.id} className="panel flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 break-words">
              <h3 className="font-semibold">{token.label}</h3>
              <p className="mt-1 text-sm">{token.scopes.join(" · ")}</p>
              <p className="mt-1 text-xs text-stone-500">
                Expires {new Date(token.expiresAt).toISOString().slice(0, 10)} UTC
              </p>
              <p className="mt-2 text-sm">{token.revokedAt ? "Revoked" : "Not revoked"}</p>
            </div>
            <button
              className="quiet-button"
              disabled={busy || Boolean(token.revokedAt)}
              onClick={() => revoke(token.id)}
            >
              Revoke {token.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Keeps issued plaintext only in component memory until dismissed or the page is left. */
export default function Tokens({
  initialTokens,
  canSpend,
}: {
  initialTokens: Token[];
  canSpend: boolean;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function command(path: string, method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        setMessage(z.object({ error: z.object({ message: z.string() }) }).parse(raw).error.message);
        return;
      }
      const result = z
        .object({ data: tokenView.extend({ secret: z.string().optional() }) })
        .parse(raw).data;
      setTokens((previous) => [
        tokenView.parse(result),
        ...previous.filter((t) => t.id !== result.id),
      ]);
      setSecret(result.secret ?? null);
      setMessage(commandMessage[method]);
    } catch {
      setMessage("Request failed. Check the token list before issuing another token.");
    } finally {
      setBusy(false);
    }
  }
  function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void command("/api/v1/desk/tokens", "POST", {
      label: form.get("label"),
      scopes: [
        "read",
        ...(form.has("write") ? ["write"] : []),
        ...(form.has("spend") ? ["spend"] : []),
      ],
      expiresAt: new Date(Date.now() + Number(form.get("days")) * 86400000).toISOString(),
    });
  }
  return (
    <>
      <form onSubmit={issue} className="panel mt-8 space-y-5">
        <h2>Create an application token</h2>
        <div>
          <label htmlFor="token-label">Label</label>
          <input
            id="token-label"
            name="label"
            required
            maxLength={100}
            placeholder="Claude Code on my laptop"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="token-expiry">Expires after</label>
          <select id="token-expiry" name="days" defaultValue="7" disabled={busy}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </div>
        <p className="text-sm text-stone-600">
          Read assigned opportunities and permitted evidence is always included.
        </p>
        <label className="check-label">
          <input name="write" type="checkbox" disabled={busy} />
          <span>Allow writes, including saving unsent drafts.</span>
        </label>
        <label className="check-label">
          <input name="spend" type="checkbox" disabled={busy || !canSpend} />
          <span>
            Allow bounded processing against my spending allowance. Processing also requires write
            permission.{!canSpend && " Your account has no spending permission."}
          </span>
        </label>
        <button className="button" disabled={busy || secret !== null}>
          Create token
        </button>
      </form>
      <output className="mt-4 block text-sm text-stone-700">{message}</output>
      <TokenSecret secret={secret} hide={() => setSecret(null)} />
      <TokenList
        tokens={tokens}
        busy={busy}
        revoke={(id) => void command(`/api/v1/desk/tokens/${id}`, "DELETE")}
      />
    </>
  );
}
