import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceOutline } from "./SourceOutline";

describe("SourceOutline", () => {
  const symbols = [
    { name: "loadProfile", kind: "function" as const, line: 12, depth: 0 },
    { name: "ProfileReader", kind: "class" as const, line: 40, depth: 1 },
  ];
  const viewport = {
    firstLine: 30,
    lastLine: 50,
    totalLines: 200,
    progress: 0.25,
  };
  const minimap = [
    {
      line: 12,
      top: 0.06,
      left: 0.04,
      width: 0.42,
      kind: "symbol" as const,
    },
    {
      line: 80,
      top: 0.4,
      left: 0.12,
      width: 0.68,
      kind: "code" as const,
    },
  ];

  it("navigates to source symbols and marks visible symbols", async () => {
    const user = userEvent.setup();
    const onNavigateLine = vi.fn();
    render(
      <SourceOutline
        symbols={symbols}
        minimap={minimap}
        viewport={viewport}
        onNavigateLine={onNavigateLine}
        onNavigateProgress={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /ProfileReader.*class.*40/i }),
    ).toHaveAttribute("data-visible", "true");
    await user.click(
      screen.getByRole("button", { name: /loadProfile.*function.*12/i }),
    );

    expect(onNavigateLine).toHaveBeenCalledWith(12);
  });

  it("exposes a keyboard-operable document position slider", async () => {
    const user = userEvent.setup();
    const onNavigateProgress = vi.fn();
    render(
      <SourceOutline
        symbols={symbols}
        minimap={minimap}
        viewport={viewport}
        onNavigateLine={vi.fn()}
        onNavigateProgress={onNavigateProgress}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Document position" });

    expect(slider).toHaveAttribute("aria-valuenow", "30");
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    expect(slider).toHaveAttribute(
      "aria-valuetext",
      "Lines 30 to 50 of 200",
    );
    slider.focus();
    await user.keyboard("{End}{Home}{PageDown}");

    expect(onNavigateProgress).toHaveBeenNthCalledWith(1, 1);
    expect(onNavigateProgress).toHaveBeenNthCalledWith(2, 0);
    expect(onNavigateProgress.mock.calls[2]?.[0]).toBeGreaterThan(0.2);
  });

  it("jumps to a clicked position on the document track", () => {
    const onNavigateProgress = vi.fn();
    render(
      <SourceOutline
        symbols={symbols}
        minimap={minimap}
        viewport={viewport}
        onNavigateLine={vi.fn()}
        onNavigateProgress={onNavigateProgress}
      />,
    );
    const slider = screen.getByRole("slider", {
      name: "Document position",
    }) as HTMLDivElement;
    slider.setPointerCapture = vi.fn();
    slider.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 300,
        height: 200,
        left: 0,
        right: 12,
        width: 12,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(slider, { clientY: 200, pointerId: 1 });

    expect(onNavigateProgress).toHaveBeenCalledWith(0.5);
    expect(
      slider.querySelectorAll(".source-outline__minimap-lines > span"),
    ).toHaveLength(2);
  });

  it("keeps document navigation available without symbols", () => {
    render(
      <SourceOutline
        symbols={[]}
        minimap={[]}
        viewport={viewport}
        onNavigateLine={vi.fn()}
        onNavigateProgress={vi.fn()}
      />,
    );

    expect(screen.getByText("No functions or symbols found.")).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Document position" }),
    ).toBeInTheDocument();
  });
});
