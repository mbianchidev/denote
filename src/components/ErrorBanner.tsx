import { X } from "lucide-react";

interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
  onNavigate?: () => void;
}

export function ErrorBanner({
  message,
  onDismiss,
  onNavigate,
}: ErrorBannerProps) {
  if (!message) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
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
