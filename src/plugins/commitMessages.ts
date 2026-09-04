const TIMESTAMP_PLACEHOLDER = "{timestamp}";

export function resolveCommitMessage(
  message: string,
  fallback: string,
  now = new Date(),
): string {
  const template = message.trim() || fallback;
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-") +
    ` ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return template.split(TIMESTAMP_PLACEHOLDER).join(timestamp);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
