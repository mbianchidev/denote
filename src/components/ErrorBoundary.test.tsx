import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

it("keeps editor loading failures inside their pane and logs the cause", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function FailedEditor(): never {
    throw new Error("Synthetic module load failure");
  }
  try {
    render(
      <>
        <p>Another pane stays available</p>
        <ErrorBoundary fallback={(error) => <p role="alert">{error.message}</p>}>
          <FailedEditor />
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Synthetic module load failure");
    expect(screen.queryByRole("button", { name: "Reload Denote" })).not.toBeInTheDocument();
    expect(screen.getByText("Another pane stays available")).toBeVisible();
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
