import { X } from "lucide-react";
import { useEffect } from "react";

export const TRANSIENT_ERROR_DURATION_MS = 4_000;

interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
  onNavigate?: () => void;
  transient?: boolean;
}

export function ErrorBanner({
  message,
  onDismiss,
  onNavigate,
  transient = false,
}: ErrorBannerProps) {
  useEffect(() => {
    if (!message || !transient) {
      return;
    }
    const timer = window.setTimeout(onDismiss, TRANSIENT_ERROR_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, transient]);

  if (!message) {
    return null;
  }
  return (
    <div
      className={`error-banner${transient ? " error-banner--transient" : ""}`}
      role="alert"
    >
      <span>{message}</span>
      <div className="error-banner__actions">
        {onNavigate ? (
          <button
            type="button"
            className="error-banner__navigate"
            onClick={onNavigate}
          >
            Navigate to error
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label="Dismiss error"
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}
