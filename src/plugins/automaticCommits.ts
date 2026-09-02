import type { PluginAutomaticLocalCommitSchedule } from "@denote/plugin-sdk";

/**
 * A standing schedule is the only capability a plugin holds without a user
 * action behind it, so every field is bounded here and again on the host side
 * before a timer is ever created.
 */
export const MIN_AUTOMATIC_COMMIT_INTERVAL_MINUTES = 1;
export const MAX_AUTOMATIC_COMMIT_INTERVAL_MINUTES = 1440;
export const MAX_AUTOMATIC_COMMIT_MESSAGE_LENGTH = 500;
export const MAX_AUTOMATIC_COMMIT_PATTERNS = 100;
export const MAX_AUTOMATIC_COMMIT_PATTERN_LENGTH = 1024;
export const MAX_AUTOMATIC_COMMIT_IDENTITY_LENGTH = 255;

/**
 * The normalized shape the host stores and the protocol carries. Optional
 * fields are resolved, so nothing downstream has to repeat the defaults.
 */
export interface PluginAutomaticLocalCommitPayload {
  id: string;
  intervalMinutes: number;
  message: string;
  includePatterns: string[];
  excludePatterns: string[];
  authorName: string | null;
  authorEmail: string | null;
}

export interface PluginAutomaticLocalCommitContribution
  extends PluginAutomaticLocalCommitPayload {
  pluginId: string;
}

/**
 * Validates and normalizes one schedule. Every failure throws, because a
 * standing schedule that is silently repaired would commit on terms the plugin
 * never asked for.
 */
export function normalizeAutomaticLocalCommitSchedule(
  pluginId: string,
  schedule: PluginAutomaticLocalCommitSchedule,
): PluginAutomaticLocalCommitPayload {
  if (!isRecord(schedule) || typeof schedule.id !== "string") {
    throw new Error("Invalid automatic local commit registration.");
  }
  if (!schedule.id.startsWith(`${pluginId}.`)) {
    throw new Error(
      `Plugin automatic local commit IDs must use the ${pluginId}. prefix.`,
    );
  }
  return normalizeScheduleFields(schedule.id, schedule);
}

function normalizeScheduleFields(
  id: string,
  schedule: PluginAutomaticLocalCommitSchedule,
): PluginAutomaticLocalCommitPayload {
  return {
    id,
    intervalMinutes: interval(schedule.intervalMinutes),
    message: message(schedule.message),
    includePatterns: patterns(schedule.includePatterns, "include"),
    excludePatterns: patterns(schedule.excludePatterns, "exclude"),
    ...identity(schedule.authorName, schedule.authorEmail),
  };
}

/**
 * Reports whether a protocol payload is a fully normalized schedule. The host
 * runtime validates every message again, so a worker that bypassed the
 * capability cannot register a schedule the host would act on. Ownership of
 * the ID is checked separately by the runtime against the sending plugin.
 */
export function isPluginAutomaticLocalCommitPayload(
  value: unknown,
): value is PluginAutomaticLocalCommitPayload {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") {
    return false;
  }
  try {
    const normalized = normalizeScheduleFields(
      value.id,
      value as unknown as PluginAutomaticLocalCommitSchedule,
    );
    return (
      normalized.authorName === (value.authorName ?? null) &&
      normalized.authorEmail === (value.authorEmail ?? null) &&
      sameStrings(normalized.includePatterns, value.includePatterns) &&
      sameStrings(normalized.excludePatterns, value.excludePatterns)
    );
  } catch {
    return false;
  }
}

/**
 * A payload must already be normalized, because the host stores it verbatim
 * and acts on it. Anything that still needs repair did not come from the
 * capability that validated it.
 */
function sameStrings(normalized: string[], value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === normalized.length &&
    normalized.every((entry, index) => entry === value[index])
  );
}

function interval(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MIN_AUTOMATIC_COMMIT_INTERVAL_MINUTES ||
    value > MAX_AUTOMATIC_COMMIT_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Automatic local commit interval must be a whole number of minutes between ${MIN_AUTOMATIC_COMMIT_INTERVAL_MINUTES} and ${MAX_AUTOMATIC_COMMIT_INTERVAL_MINUTES}.`,
    );
  }
  return value;
}

function message(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_AUTOMATIC_COMMIT_MESSAGE_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new Error(
      "Automatic local commit message must be single-line text within 500 characters.",
    );
  }
  return value;
}

function patterns(value: unknown, kind: "include" | "exclude"): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_AUTOMATIC_COMMIT_PATTERNS) {
    throw new Error(
      `Automatic local commit ${kind} patterns must be a list of at most ${MAX_AUTOMATIC_COMMIT_PATTERNS} path prefixes.`,
    );
  }
  return value.map((entry) => pathPrefix(entry, kind));
}

/**
 * A pattern is a repository-relative path prefix, never a glob and never a
 * pathspec. Anything that could escape the repository, address Git metadata,
 * or reach the transport as an option is refused.
 */
function pathPrefix(value: unknown, kind: "include" | "exclude"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_AUTOMATIC_COMMIT_PATTERN_LENGTH
  ) {
    throw new Error(
      `Automatic local commit ${kind} patterns must be non-empty relative path prefixes.`,
    );
  }
  const trimmed = value.replace(/\/+$/, "");
  if (
    trimmed.length === 0 ||
    hasControlCharacter(trimmed) ||
    trimmed.startsWith("-") ||
    trimmed.startsWith(":") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed
      .split("/")
      .some(
        (segment) =>
          segment.length === 0 ||
          segment === "." ||
          segment === ".." ||
          segment.toLowerCase() === ".git",
      )
  ) {
    throw new Error(
      `Automatic local commit ${kind} patterns must be repository-relative path prefixes.`,
    );
  }
  return trimmed;
}

/**
 * Git records a commit as `name <email>`, so a half-configured identity would
 * silently mix a plugin value with a repository value.
 */
function identity(
  name: unknown,
  email: unknown,
): { authorName: string | null; authorEmail: string | null } {
  const providedName = name ?? undefined;
  const providedEmail = email ?? undefined;
  if (providedName === undefined && providedEmail === undefined) {
    return { authorName: null, authorEmail: null };
  }
  const authorName = identityValue(providedName, "author name");
  const authorEmail = identityValue(providedEmail, "author email");
  if (authorName === null || authorEmail === null) {
    throw new Error(
      "Automatic local commit identity requires both an author name and an author email.",
    );
  }
  return { authorName, authorEmail };
}

function identityValue(value: unknown, label: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_AUTOMATIC_COMMIT_IDENTITY_LENGTH ||
    hasControlCharacter(value) ||
    value.includes("<") ||
    value.includes(">")
  ) {
    throw new Error(
      `Automatic local commit ${label} must be single-line text without angle brackets.`,
    );
  }
  return value;
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
