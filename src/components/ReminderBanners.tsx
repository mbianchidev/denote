import { Bell, X } from "lucide-react";
import type { ReminderBump } from "../plugins/useReminderScheduler";

interface ReminderBannersProps {
  bumps: ReminderBump[];
  onOpen: (bump: ReminderBump) => void;
  onDismiss: (id: string) => void;
}

const MAX_VISIBLE_BUMPS = 3;

export function ReminderBanners({
  bumps,
  onOpen,
  onDismiss,
}: ReminderBannersProps) {
  if (bumps.length === 0) {
    return null;
  }
  const visible = bumps.slice(-MAX_VISIBLE_BUMPS);
  const hiddenCount = bumps.length - visible.length;
  const latest = visible[visible.length - 1];

  return (
    <section className="reminder-bumps" aria-label="Due reminders">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {latest.reminder.title} is due. {bumps.length} reminder
        {bumps.length === 1 ? "" : "s"} need attention.
      </p>
      <ul>
        {visible.map((bump) => (
          <li key={bump.id}>
            <Bell aria-hidden="true" size={16} />
            <div>
              <strong>{bump.reminder.title}</strong>
              <span>{bumpTarget(bump)}</span>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpen(bump)}
            >
              Open reminders
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Dismiss banner for ${bump.reminder.title}`}
              onClick={() => onDismiss(bump.id)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <p>{hiddenCount} more due reminder{hiddenCount === 1 ? "" : "s"}.</p>
      ) : null}
    </section>
  );
}

function bumpTarget(bump: ReminderBump): string {
  const { target } = bump.reminder;
  if (target.kind === "standalone") {
    return "Standalone reminder";
  }
  return target.noteTitle ?? target.path ?? "Linked note";
}
