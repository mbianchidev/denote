import { listen } from "@tauri-apps/api/event";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import {
  credentialServiceUrl, isCredentialResult, type CredentialCopyField, type CredentialEntry, type CredentialRequest,
  type CredentialResult, type CredentialSnapshot,
} from "../lib/credentials";
import { SensitiveToolPanel } from "./SensitiveToolPanel";
import "./SensitiveTools.css";

export function CredentialStorePanel({ pluginId, workspaceScope, onClose, onOpenService, onLock }: {
  pluginId: string; workspaceScope: string; onClose: () => void;
  onOpenService: (url: string) => Promise<void>;
  onLock?: () => void;
}) {
  const callbacks = useRef({ onOpenService, onLock });
  callbacks.current = { onOpenService, onLock };
  const [snapshot, setSnapshot] = useState<CredentialSnapshot | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"service" | "username">("service");
  const [editing, setEditing] = useState<CredentialEntry | "new" | null>(null);
  const [replaceSecret, setReplaceSecret] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [inactivity, setInactivity] = useState(300);
  const inactivityRef = useRef(inactivity);
  inactivityRef.current = inactivity;
  const [clipboardTimeout, setClipboardTimeout] = useState(30);
  const [transfer, setTransfer] = useState<{ kind: "import" | "export"; ticket: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const lastActivity = useRef(Date.now());
  const lastTouch = useRef(0);
  const actionRef = useRef<HTMLButtonElement>(null);

  const clearInputs = () => {
    root.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach((input) => {
      if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = false;
      else input.value = "";
    });
  };
  const release = (session: string) => api.credentialStore(pluginId, workspaceScope, { action: "lock", session });
  const lock = () => {
    ++epoch.current;
    callbacks.current.onLock?.();
    const previous = snapshotRef.current;
    snapshotRef.current = null;
    setSnapshot(null); setRevealed(null); setEditing(null); setDeleting(null); setQuery("");
    setBusy(false);
    clearInputs();
    callbacks.current.onLock?.();
    setStatus("Credential store locked.");
    if (previous) void release(previous.session).catch((caught) => { if (alive.current) setError(errorMessage(caught)); });
  };
  const lockRef = useRef(lock);
  lockRef.current = lock;
  const run = async (request: CredentialRequest): Promise<CredentialResult> => {
    const revision = epoch.current;
    const result = await api.credentialStore(pluginId, workspaceScope, request);
    if (!isCredentialResult(result)) throw new Error("The credential host returned an invalid response. Lock and reopen the store.");
    if (!alive.current || revision !== epoch.current) {
      if (result.kind === "snapshot") await release(result.session);
      throw new Error("The credential action ended after the store was locked.");
    }
    if (result.kind === "snapshot") {
      snapshotRef.current = result;
      setSnapshot(result);
      setExists(true);
      lastActivity.current = Date.now();
    }
    return result;
  };
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    const revision = epoch.current;
    setBusy(true); setError(""); setStatus("");
    try { await operation(); }
    catch (caught) { if (alive.current && revision === epoch.current) setError(errorMessage(caught)); }
    finally { if (alive.current && revision === epoch.current) setBusy(false); }
  };
  useEffect(() => {
    alive.current = true;
    const revision = epoch.current;
    void api.credentialStore(pluginId, workspaceScope, { action: "status" }).then((result) => {
      if (!alive.current || revision !== epoch.current) return;
      if (!isCredentialResult(result) || result.kind !== "status") throw new Error("The credential file status is unavailable.");
      setExists(result.exists);
    }).catch((caught) => { if (alive.current) setError(errorMessage(caught)); });
    const blur = (event: Event) => { if (event.target === event.currentTarget) lockRef.current(); };
    window.addEventListener("blur", blur);
    const stopLock = listen("denote://sensitive-locked", () => lockRef.current());
    const stopError = listen<string>("denote://sensitive-error", (event) => {
      if (alive.current) setError(event.payload);
    });
    const timer = window.setInterval(() => {
      if (snapshotRef.current && Date.now() - lastActivity.current >= inactivityRef.current * 1000) lockRef.current();
    }, 1000);
    return () => {
      alive.current = false; ++epoch.current;
      window.removeEventListener("blur", blur);
      window.clearInterval(timer);
      void stopLock.then((stop) => stop()).catch(() => console.error("Credential lock listener cleanup failed."));
      void stopError.then((stop) => stop()).catch(() => console.error("Credential error listener cleanup failed."));
      clearInputs();
      const current = snapshotRef.current;
      snapshotRef.current = null;
      if (current) void release(current.session).catch(() => console.error("Credential session cleanup failed."));
    };
  }, [pluginId, workspaceScope]);
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(null), 15000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const activity = () => {
    const current = snapshotRef.current;
    if (!current) return;
    if (Date.now() - lastActivity.current >= inactivityRef.current * 1000) { lockRef.current(); return; }
    lastActivity.current = Date.now();
    if (lastActivity.current - lastTouch.current < 1000) return;
    lastTouch.current = lastActivity.current;
    void api.credentialStore(pluginId, workspaceScope, { action: "touch", session: current.session })
      .catch((caught) => {
        if (snapshotRef.current?.session !== current.session) return;
        lockRef.current(); if (alive.current) setError(errorMessage(caught));
      });
  };
  const authenticate = (form: HTMLFormElement) => {
    const values = new FormData(form);
    const password = String(values.get("password") ?? "");
    const confirmation = String(values.get("confirmation") ?? "");
    form.reset();
    void perform(async () => {
      await run(exists ? { action: "unlock", password, timeout: inactivity } :
        { action: "create", password, confirmation, timeout: inactivity });
      setStatus("Credential store unlocked.");
    });
  };
  const chooseTransfer = (kind: "backup" | "import" | "export") => void perform(async () => {
    setRevealed(null);
    const result = await api.credentialTransfer(pluginId, workspaceScope, kind, snapshotRef.current?.session ?? null);
    if (!alive.current) return;
    if (!isCredentialResult(result)) throw new Error("The credential transfer returned an invalid response.");
    if (result.kind === "cancelled") { setStatus("Transfer cancelled. Existing credentials are unchanged."); return; }
    if (kind === "backup" && result.kind === "done") { setStatus("Encrypted backup saved."); return; }
    if (kind !== "backup" && result.kind === "prepared") { setTransfer({ kind, ticket: result.ticket }); return; }
    throw new Error("Choose the credential transfer file again.");
  });
  const rows = snapshot?.entries.filter((entry) =>
    [entry.service, entry.username, entry.url, entry.notes].some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    .sort((left, right) => left[sort].localeCompare(right[sort])) ?? [];
  const restoreAction = () => window.requestAnimationFrame(() => actionRef.current?.focus());
  const copyEntry = (entry: CredentialEntry, field: CredentialCopyField) => void perform(async () => {
    const current = snapshotRef.current;
    if (!current) throw new Error("Unlock the credential store before copying.");
    await run({ action: "copy", session: current.session, id: entry.id, field, timeout: clipboardTimeout });
    setStatus(`Copied ${field}. Denote will try to clear it after ${clipboardTimeout} seconds.`);
  });

  return <SensitiveToolPanel title="Credential store" feature="credential-store" onClose={onClose}>
    <div ref={root} className="sensitive-tool" onKeyDownCapture={activity} onPointerDownCapture={activity}>
      <p className="authoring-muted">All entry fields stay encrypted in .denote/credentials.dncred. Forgotten master passwords cannot be recovered.</p>
      {error ? <p role="alert" className="authoring-error">{error}</p> : null}
      <p role="status">{busy ? "Working…" : status}</p>
      <div className="authoring-actions">
        <label>Lock after <select value={inactivity} disabled={snapshot !== null} onChange={(event) => setInactivity(Number(event.currentTarget.value))}>
          <option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={900}>15 minutes</option>
        </select></label>
        <label>Clear copied fields after <select value={clipboardTimeout} onChange={(event) => setClipboardTimeout(Number(event.currentTarget.value))}>
          <option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option>
        </select></label>
        {snapshot ? <button type="button" className="secondary-button" onClick={lock}>Lock now</button> : null}
      </div>
      {transfer ? <form onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const password = String(values.get("password") ?? "");
        const currentPassword = String(values.get("current-password") ?? "");
        const confirmed = values.get("confirmed") === "on";
        event.currentTarget.reset();
        const selected = transfer;
        setTransfer(null);
        void perform(async () => {
          await run(selected.kind === "export" ? { action: "export", ticket: selected.ticket, password, confirmed } :
            { action: "import", ticket: selected.ticket, password, current_password: currentPassword, confirmed, timeout: inactivity });
          setStatus(selected.kind === "export" ? "Plaintext export saved. Protect or delete the exported file yourself." : "Encrypted backup imported.");
          restoreAction();
        });
      }}>
        <h3>{transfer.kind === "export" ? "Authenticate plaintext export" : "Authenticate encrypted import"}</h3>
        <label>{transfer.kind === "export" ? "Current master password" : "Backup master password"}
          <input type="password" name="password" autoComplete="off" maxLength={1024} required autoFocus /></label>
        {transfer.kind === "import" && exists ? <label>Current store master password
          <input type="password" name="current-password" autoComplete="off" maxLength={1024} required /></label> : null}
        <label className="sensitive-tool__check"><input type="checkbox" name="confirmed" required />
          {transfer.kind === "export" ? "I understand this file exposes every credential in plaintext." : "Replace the current encrypted store with this authenticated backup."}
        </label>
        <div className="authoring-actions">
          <button type="button" className="secondary-button" onClick={() => { setTransfer(null); restoreAction(); }}>Cancel transfer</button>
          <button type="submit" className="primary-button" disabled={busy}>{transfer.kind === "export" ? "Export plaintext" : "Import encrypted backup"}</button>
        </div>
      </form> : !snapshot ? <form onSubmit={(event) => { event.preventDefault(); authenticate(event.currentTarget); }}>
        <label>Master password<input type="password" name="password" autoComplete="off" maxLength={1024} required disabled={busy || exists === null} autoFocus /></label>
        {exists === false ? <label>Confirm master password<input type="password" name="confirmation" autoComplete="off" maxLength={1024} minLength={12} required disabled={busy} /></label> : null}
        <button type="submit" className="primary-button" disabled={busy || exists === null}>{exists ? "Unlock credential store" : exists === false ? "Create credential store" : "Checking credential file…"}</button>
        {exists === false ? <button type="button" className="secondary-button" disabled={busy} onClick={() => chooseTransfer("import")}>Import encrypted backup</button> : null}
      </form> : <>
        <div className="authoring-actions">
          <label>Search entries<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} autoComplete="off" /></label>
          <label>Sort entries <select value={sort} onChange={(event) => setSort(event.currentTarget.value === "username" ? "username" : "service")}>
            <option value="service">Service</option><option value="username">Username</option>
          </select></label>
          <button ref={actionRef} type="button" className={editing ? "secondary-button" : "primary-button"} disabled={busy} onClick={() => { setEditing("new"); setReplaceSecret(true); }}>New entry</button>
        </div>
        <p className="authoring-muted">Show exposes a secret for 15 seconds. Copy can expose it to other apps and clipboard history; automatic clearing is best effort.</p>
        <div className="sensitive-tool__table" role="region" aria-label="Credential entries" tabIndex={0}><table>
          <caption>Unlocked credential entries</caption>
          <thead><tr><th scope="col">Service</th><th scope="col">Username</th><th scope="col">Secret</th><th scope="col">Actions</th></tr></thead>
          <tbody>{rows.map((entry) => {
            const url = credentialServiceUrl(entry.url);
            return <tr key={entry.id}>
            <th scope="row">
              <div className="credential-cell">
                <span>{entry.service}</span>
                <button type="button" className="icon-button" disabled={busy} aria-label={`Copy service for ${entry.service}`}
                  title="Copy service" onClick={() => copyEntry(entry, "service")}><Copy size={14} aria-hidden="true" /></button>
              </div>
              {url ? <a href={url} aria-label={`Open ${entry.service}`} onClick={(event) => {
                event.preventDefault();
                void perform(async () => {
                  try { await callbacks.current.onOpenService(url); }
                  catch { throw new Error("The service link could not be opened. Check your browser and try again."); }
                });
              }} onAuxClick={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}>{new URL(url).host}</a> :
                entry.url ? <span className="authoring-error">Unsupported service link</span> : null}
            </th>
            <td><div className="credential-cell">
              <span>{entry.username}</span>
              <button type="button" className="icon-button" disabled={busy} aria-label={`Copy username for ${entry.service}`}
                title="Copy username" onClick={() => copyEntry(entry, "username")}><Copy size={14} aria-hidden="true" /></button>
            </div></td>
            <td>
              <output className="credential-secret" aria-label={`Secret for ${entry.service}`} aria-live="off">{revealed?.id === entry.id ? revealed.value : "********"}</output>
              <div className="credential-cell">
              <button type="button" className="secondary-button" disabled={busy} aria-label={`${revealed?.id === entry.id ? "Hide" : "Show"} secret for ${entry.service}`}
                onClick={() => revealed?.id === entry.id ? setRevealed(null) : void perform(async () => {
                  const result = await run({ action: "reveal", session: snapshot.session, id: entry.id });
                  if (result.kind !== "revealed") throw new Error("The secret could not be revealed.");
                  setRevealed({ id: entry.id, value: result.value });
                })}>{revealed?.id === entry.id ? "Hide" : "Show"}</button>
              <button type="button" className="icon-button" disabled={busy} aria-label={`Copy secret for ${entry.service}`}
                title="Copy secret" onClick={() => copyEntry(entry, "secret")}><Copy size={14} aria-hidden="true" /></button>
              </div>
            </td>
            <td><div className="authoring-actions">
              <button type="button" className="secondary-button" aria-label={`Edit ${entry.service}`} disabled={busy}
                onClick={() => { setEditing(entry); setReplaceSecret(false); setRevealed(null); }}>Edit</button>
              <button type="button" className="secondary-button" aria-label={`Delete ${entry.service}`} disabled={busy}
                onClick={() => setDeleting(entry.id)}>Delete</button>
              {deleting === entry.id ? <span role="group" aria-label={`Delete ${entry.service}?`}>
                <button type="button" className="secondary-button" onClick={() => setDeleting(null)}>Cancel</button>
                <button type="button" className="danger-button" disabled={busy} onClick={() => void perform(async () => {
                  await run({ action: "delete", session: snapshot.session, hash: snapshot.hash, id: entry.id });
                  setDeleting(null); setStatus("Credential deleted."); restoreAction();
                })}>Confirm delete</button>
              </span> : null}
            </div></td>
          </tr>;
          })}</tbody>
        </table></div>
        {!rows.length ? <p>No matching entries.</p> : null}
        {editing ? <form key={editing === "new" ? "new" : editing.id} onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const entry = {
            id: editing === "new" ? null : editing.id,
            service: String(values.get("service") ?? ""), username: String(values.get("username") ?? ""),
            secret: replaceSecret ? String(values.get("secret") ?? "") : null,
            url: String(values.get("url") ?? ""), notes: String(values.get("notes") ?? ""),
          };
          const secret = event.currentTarget.elements.namedItem("secret");
          if (secret instanceof HTMLInputElement) secret.value = "";
          void perform(async () => {
            await run({ action: "upsert", session: snapshot.session, hash: snapshot.hash, entry });
            setEditing(null); setStatus("Credential saved."); restoreAction();
          });
        }}>
          <h3>{editing === "new" ? "New entry" : "Edit entry"}</h3>
          <label>Service<input name="service" defaultValue={editing === "new" ? "" : editing.service} required maxLength={1024} autoComplete="off" autoFocus /></label>
          <label>Username<input name="username" defaultValue={editing === "new" ? "" : editing.username} maxLength={4096} autoComplete="off" /></label>
          {editing !== "new" ? <label className="sensitive-tool__check"><input type="checkbox" checked={replaceSecret}
            onChange={(event) => setReplaceSecret(event.currentTarget.checked)} />Replace existing secret</label> : null}
          {replaceSecret ? <label>Password or token<input name="secret" type="password" maxLength={16384} autoComplete="off" /></label> : <p>The existing secret stays unchanged.</p>}
          <label>URL<input name="url" defaultValue={editing === "new" ? "" : editing.url} maxLength={4096} autoComplete="off" /></label>
          <label>Entry notes<textarea name="notes" defaultValue={editing === "new" ? "" : editing.notes} maxLength={16384} rows={3} /></label>
          <div className="authoring-actions">
            <button type="button" className="secondary-button" onClick={() => { clearInputs(); setEditing(null); restoreAction(); }}>Cancel edit</button>
            <button type="submit" className="primary-button" disabled={busy}>Save entry</button>
          </div>
        </form> : <div className="authoring-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => chooseTransfer("backup")}>Encrypted backup</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => chooseTransfer("import")}>Import encrypted backup</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => chooseTransfer("export")}>Plaintext export</button>
        </div>}
      </>}
    </div>
  </SensitiveToolPanel>;
}
