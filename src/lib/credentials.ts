export interface CredentialEntry {
  id: string;
  service: string;
  username: string;
  url: string;
  notes: string;
}

export interface CredentialEntryInput extends Omit<CredentialEntry, "id"> {
  id: string | null;
  secret: string | null;
}

export type CredentialCopyField = "service" | "username" | "secret";

export function credentialServiceUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export type CredentialRequest =
  | { action: "status" }
  | { action: "create"; password: string; confirmation: string; timeout: number }
  | { action: "unlock"; password: string; timeout: number }
  | { action: "list" | "touch" | "lock"; session: string }
  | { action: "upsert"; session: string; hash: string; entry: CredentialEntryInput }
  | { action: "delete"; session: string; hash: string; id: string }
  | { action: "reveal"; session: string; id: string }
  | { action: "copy"; session: string; id: string; field: CredentialCopyField; timeout: number }
  | { action: "export"; ticket: string; password: string; confirmed: boolean }
  | { action: "import"; ticket: string; password: string; current_password: string; confirmed: boolean; timeout: number };

export type CredentialSnapshot = { kind: "snapshot"; session: string; hash: string; entries: CredentialEntry[] };
export type CredentialResult =
  | CredentialSnapshot
  | { kind: "status"; exists: boolean }
  | { kind: "revealed"; value: string }
  | { kind: "prepared"; ticket: string }
  | { kind: "done" | "cancelled" };

export function isCredentialResult(value: unknown): value is CredentialResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.kind === "done" || result.kind === "cancelled") return Object.keys(result).length === 1;
  if (result.kind === "status") return typeof result.exists === "boolean" && Object.keys(result).length === 2;
  if (result.kind === "revealed") return typeof result.value === "string" && result.value.length <= 16384 && Object.keys(result).length === 2;
  if (result.kind === "prepared") return typeof result.ticket === "string" && result.ticket.length <= 80 && Object.keys(result).length === 2;
  return result.kind === "snapshot" && typeof result.session === "string" && result.session.length <= 80 &&
    typeof result.hash === "string" && /^[a-f0-9]{64}$/.test(result.hash) && Object.keys(result).length === 4 &&
    Array.isArray(result.entries) && result.entries.length <= 1000 && new Set(result.entries.map((entry) => entry?.id)).size === result.entries.length &&
    result.entries.every((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const row = entry as Record<string, unknown>;
      return Object.keys(row).length === 5 && ["id", "service", "username", "url", "notes"].every((key) =>
        typeof row[key] === "string" && row[key].length <= 16384);
    });
}
