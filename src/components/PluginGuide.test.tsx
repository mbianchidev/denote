import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginGuide } from "./PluginGuide";

describe("PluginGuide", () => {
  it("renders safe inline and block Markdown without exposing syntax markers", () => {
    render(
      <PluginGuide
        guide={[
          "# Synthetic plugin",
          "",
          "## Enablement and permissions",
          "",
          "Open **Settings → Plugins** and approve `Reminders`.",
          "",
          "- Choose **Open note**.",
          "- Choose *Snooze*.",
          "",
          "```text",
          "synthetic reminder",
          "```",
        ].join("\n")}
      />,
    );

    const section = screen
      .getByText("Enablement and permissions")
      .closest(".plugin-guide__section");
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText("Settings → Plugins").tagName)
      .toBe("STRONG");
    expect(within(section as HTMLElement).getByText("Reminders").tagName)
      .toBe("CODE");
    expect(within(section as HTMLElement).getByText("Open note").tagName)
      .toBe("STRONG");
    expect(within(section as HTMLElement).getByText("Snooze").tagName)
      .toBe("EM");
    expect(within(section as HTMLElement).getByText("synthetic reminder").tagName)
      .toBe("CODE");
    expect(section).not.toHaveTextContent("**");
    expect(section).not.toHaveTextContent("```");
  });
});
