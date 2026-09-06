import type { AppError } from "./appErrors";
import type { BuildInfo } from "./buildInfo";
import type { RuntimeInfo } from "../types";

const ISSUE_URL = "https://github.com/mbianchidev/denote/issues/new";
const MAX_DIAGNOSTICS = 5;
const MAX_DIAGNOSTIC_LENGTH = 280;
const MAX_EXCERPT_LENGTH = 1_600;
const MAX_BODY_LENGTH = 5_500;
const MAX_URL_LENGTH = 7_500;

export interface DiagnosticEvent {
  code: string;
  summary: string;
}

export interface BugReportInput {
  buildInfo: BuildInfo;
  runtimeInfo: RuntimeInfo | null;
  currentError: AppError | null;
  diagnostics: DiagnosticEvent[];
}

export function appendDiagnostic(
  diagnostics: DiagnosticEvent[],
  event: DiagnosticEvent,
): DiagnosticEvent[] {
  return [...diagnostics, sanitizeDiagnostic(event)].slice(-MAX_DIAGNOSTICS);
}

export function buildBugReportUrl(input: BugReportInput): string {
  const body = buildBugReportBody(input).slice(0, MAX_BODY_LENGTH);
  const url = new URL(ISSUE_URL);
  url.searchParams.set("template", "bug_report.md");
  url.searchParams.set("title", "Bug: ");
  url.searchParams.set("labels", "bug");
  url.searchParams.set("body", body);
  if (url.toString().length > MAX_URL_LENGTH) {
    url.searchParams.set(
      "body",
      buildBugReportBody({ ...input, diagnostics: [] }).slice(0, MAX_BODY_LENGTH),
    );
  }
  if (url.toString().length > MAX_URL_LENGTH) {
    throw new Error("The bug report URL exceeds the safe length limit.");
  }
  return url.toString();
}

export function buildBugReportBody(input: BugReportInput): string {
  const runtime = input.runtimeInfo;
  const diagnostics = [
    ...input.diagnostics,
    ...(input.currentError
      ? [
          {
            code: errorCode(input.currentError),
            summary: input.currentError.message,
          },
        ]
      : []),
  ]
    .map(sanitizeDiagnostic)
    .slice(-MAX_DIAGNOSTICS);
  const excerpt =
    diagnostics.length > 0
      ? diagnostics
          .map(({ code, summary }) => `[${code}] ${summary}`)
          .join("\n")
          .slice(0, MAX_EXCERPT_LENGTH)
      : "No recent user-visible diagnostics.";

  return `## What happened?

<!-- Describe the problem. Review and edit all generated text before submitting. -->

## Steps to reproduce

1.

## Expected behavior

<!-- What should Denote have done? -->

## Denote diagnostics

\`\`\`text
Version: ${sanitizeMetadata(input.buildInfo.version)}
Source SHA: ${sanitizeMetadata(input.buildInfo.commitHash)}
Operating system: ${sanitizeMetadata(runtime?.operatingSystem ?? "Unknown")}
Architecture: ${sanitizeMetadata(runtime?.architecture ?? "Unknown")}
Bundle type: ${sanitizeMetadata(runtime?.bundleType ?? "Unknown")}
Update channel: ${sanitizeMetadata(runtime?.updateChannel ?? "Unknown")}
Current error code: ${input.currentError ? errorCode(input.currentError) : "NO_CURRENT_ERROR"}

Recent bounded diagnostics:
${excerpt}
\`\`\`

## Additional context

<!-- Do not include note contents, vault paths, usernames, credentials, tokens, or private remote URLs. -->
`;
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"')\]]+/gi, "[redacted URL]")
    .replace(/\\\\[^\\\s]+\\[^ \n\r\t"']+/g, "[redacted path]")
    .replace(/\b[A-Za-z]:\\[^ \n\r\t"']+/g, "[redacted path]")
    .replace(
      /(^|[\s("'`])\/(?:Users|home|private|tmp|var|Volumes|mnt|media)\/[^ \n\r\t"'`)]+/g,
      "$1[redacted path]",
    )
    .replace(/~\/[^ \n\r\t"']+/g, "[redacted path]")
    .replace(
      /\b(password|passwd|token|secret|authorization|credential)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/["'`]([^"'`\n]*[\\/][^"'`\n]*)["'`]/g, "[redacted path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function sanitizeDiagnostic(event: DiagnosticEvent): DiagnosticEvent {
  return {
    code: event.code.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 64) || "UNKNOWN",
    summary: redactDiagnosticText(event.summary) || "Details redacted.",
  };
}

function sanitizeMetadata(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 120);
}

function errorCode(error: AppError): string {
  switch (error.kind) {
    case "link":
      return "EXTERNAL_LINK_ERROR";
    case "markdown":
      return "MARKDOWN_PARSE_ERROR";
    case "generic":
      return "APPLICATION_ERROR";
  }
}
