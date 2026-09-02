export interface GitCommitIdentity {
  authorName: string;
  authorEmail: string;
}

export interface GitPluginSettings {
  defaultBranch: string;
  identity: GitCommitIdentity | null;
  autoCommitIntervalMinutes: number;
  autoCommitMessage: string;
  includePatterns: string[];
  excludePatterns: string[];
}

const DEFAULT_BRANCH = "main";
const DEFAULT_AUTO_COMMIT_MESSAGE = "Denote automatic commit";
const MAX_IDENTITY_LENGTH = 255;
const MAX_MINUTES = 1440;

export const DEFAULT_SETTINGS: GitPluginSettings = {
  defaultBranch: DEFAULT_BRANCH,
  identity: null,
  autoCommitIntervalMinutes: 0,
  autoCommitMessage: DEFAULT_AUTO_COMMIT_MESSAGE,
  includePatterns: [],
  excludePatterns: [],
};

/**
 * Normalizes persisted settings into the values this plugin acts on.
 *
 * The host already validates types and ranges, so anything unusable here is a
 * stale or hand-edited value: it falls back to the documented default rather
 * than travelling into a Git request.
 */
export function readGitSettings(value: unknown): GitPluginSettings {
  const settings = isRecord(value) ? value : {};
  return {
    defaultBranch: branchName(settings.defaultBranch),
    identity: commitIdentity(settings.authorName, settings.authorEmail),
    autoCommitIntervalMinutes: minutes(settings.autoCommitIntervalMinutes),
    autoCommitMessage:
      trimmedText(settings.autoCommitMessage, 500) ??
      DEFAULT_AUTO_COMMIT_MESSAGE,
    includePatterns: patterns(settings.includePatterns),
    excludePatterns: patterns(settings.excludePatterns),
  };
}

/**
 * An identity is used only when both halves are present and safe, because Git
 * records a commit as `name <email>` and a half-configured identity would
 * silently mix a configured value with a repository value.
 */
function commitIdentity(
  name: unknown,
  email: unknown,
): GitCommitIdentity | null {
  const authorName = identityValue(name);
  const authorEmail = identityValue(email);
  return authorName && authorEmail ? { authorName, authorEmail } : null;
}

function identityValue(value: unknown): string | null {
  const text = trimmedText(value, MAX_IDENTITY_LENGTH);
  if (!text || text.includes("<") || text.includes(">")) {
    return null;
  }
  return text;
}

function branchName(value: unknown): string {
  const text = trimmedText(value, 200);
  if (
    !text ||
    text.includes("..") ||
    text.startsWith("-") ||
    text.endsWith(".lock") ||
    /[\s~^:?*[\\]/.test(text)
  ) {
    return DEFAULT_BRANCH;
  }
  return text;
}

function minutes(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_MINUTES
  ) {
    return 0;
  }
  return value;
}

/**
 * Comma-separated relative path prefixes. Anything that is not a plain
 * repository-relative prefix is dropped rather than sent to the host, which
 * would refuse the whole schedule and leave automatic commits unregistered.
 */
function patterns(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(isPathPrefix)
    .slice(0, 100);
}

function isPathPrefix(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    !hasControlCharacter(value) &&
    !value.startsWith("-") &&
    !value.startsWith(":") &&
    !value.startsWith("/") &&
    !value.startsWith("~") &&
    !value.includes("\\") &&
    !/^[A-Za-z]:/.test(value) &&
    value
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          segment.toLowerCase() !== ".git",
      )
  );
}

function trimmedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text || text.length > maximum || hasControlCharacter(text)) {
    return null;
  }
  return text;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
