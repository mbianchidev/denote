import { useState } from "react";

interface GitProjectSuggestionProps {
  onAccept: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
}

export function GitProjectSuggestion({
  onAccept,
  onDecline,
}: GitProjectSuggestionProps) {
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);

  const run = async (
    action: "accept" | "decline",
    callback: () => void | Promise<void>,
  ) => {
    if (pending !== null) {
      return;
    }
    setPending(action);
    try {
      await callback();
    } finally {
      setPending(null);
    }
  };

  return (
    <aside
      className="git-project-suggestion"
      aria-labelledby="git-project-suggestion-title"
    >
      <div className="git-project-suggestion__copy">
        <strong id="git-project-suggestion-title">
          This vault looks like a Git repository.
        </strong>
        <span>
          Mark it as a project to use project-aware editing and plugin tools.
        </span>
      </div>
      <div
        className="git-project-suggestion__actions"
        aria-label="Git repository suggestion actions"
      >
        <button
          type="button"
          className="git-project-suggestion__accept"
          disabled={pending !== null}
          onClick={() => void run("accept", onAccept)}
        >
          Mark as project
        </button>
        <button
          type="button"
          className="git-project-suggestion__decline"
          disabled={pending !== null}
          onClick={() => void run("decline", onDecline)}
        >
          No thanks
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {pending === "accept"
          ? "Marking the vault as a project"
          : pending === "decline"
            ? "Dismissing the Git repository suggestion"
            : ""}
      </span>
    </aside>
  );
}
