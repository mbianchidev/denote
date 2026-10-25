import { BellRing } from "lucide-react";
import { useRef, useState } from "react";
import type { ClockAlert, ClockController } from "../plugins/useClocks";
import { errorMessage } from "../lib/api";

interface Props {
  controller: ClockController;
  onOpen: (alert: ClockAlert) => void;
  canOpen: boolean;
  onError: (error: unknown) => void;
}

export function ClockBanners({ controller, onOpen, canOpen, onError }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  if (controller.alerts.length === 0) return null;
  const actOn = async (alert: ClockAlert, snooze: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError(null);
    try {
      await controller.mutate(alert.provider, {
        type: snooze ? "alarm-snooze" : alert.kind === "alarm" ? "alarm-dismiss" : "countdown-dismiss",
        id: alert.id, occurrence: alert.occurrence,
      });
    } catch (failure) {
      setError(errorMessage(failure));
      onError(failure);
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };
  return (
    <section className="clock-bumps" aria-label="Clock alerts">
      <p role="status" className="sr-only" aria-live="polite" aria-atomic="true">
        {controller.alerts.length} clock alert{controller.alerts.length === 1 ? " needs" : "s need"} attention.
      </p>
      <ul>
        {controller.alerts.slice(0, 5).map((alert) => (
          <li key={`${alert.provider.pluginId}:${alert.kind}:${alert.id}:${alert.occurrence}`}>
            <BellRing aria-hidden="true" size={16} />
            <div><strong>{alert.title}</strong><span>{alert.kind === "alarm" ? "Alarm" : "Countdown finished"}</span>
              {alert.error ? <span className="clock-panel__error">{alert.error}</span> : null}</div>
            <button className="secondary-button" type="button" disabled={!canOpen} onClick={() => onOpen(alert)}>Open clocks</button>
            {alert.kind === "alarm" ? <button className="secondary-button" type="button" disabled={working}
              onClick={() => void actOn(alert, true)}>Snooze 5 min</button> : null}
            <button className="secondary-button" type="button" disabled={working}
              aria-label={`Dismiss ${alert.kind} ${alert.title}`} onClick={() => void actOn(alert, false)}>Dismiss</button>
          </li>
        ))}
      </ul>
      <div className="clock-panel__actions">
        <button className="secondary-button" type="button" onClick={controller.silence}>Stop sound</button>
        {!controller.soundReady ? <button className="secondary-button" type="button"
          onClick={() => void controller.enableSound()}>Enable alarm sound</button> : null}
        {controller.alerts.length > 5 ? <span>{controller.alerts.length - 5} more clock alerts.</span> : null}
      </div>
      {error ? <p role="alert" className="clock-panel__error">{error}</p> : null}
      {controller.soundError ? <p className="clock-panel__error">{controller.soundError}</p> : null}
    </section>
  );
}
