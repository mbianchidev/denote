import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATIC_LANGUAGE,
  PLAIN_TEXT_LANGUAGE,
} from "../lib/syntaxLanguages";
import {
  LanguageCombobox,
  filterLanguageOptions,
} from "./LanguageCombobox";

describe("LanguageCombobox", () => {
  it("filters supported languages by name, alias, and extension", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LanguageCombobox
        label="Source language"
        value={AUTOMATIC_LANGUAGE}
        currentLabel="TypeScript (Automatic)"
        onSelect={onSelect}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Source language: TypeScript (Automatic)",
      }),
    );
    const input = screen.getByRole("combobox", {
      name: "Search source language",
    });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("option", { name: /Automatic.*Current selection/i }),
    ).toHaveAttribute("aria-selected", "true");

    await user.type(input, "exs");
    expect(screen.getByRole("option", { name: "Elixir" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "TypeScript" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("elixir");
  });

  it("supports arrow navigation and Plain text selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LanguageCombobox
        label="Code block language"
        value={AUTOMATIC_LANGUAGE}
        currentLabel="Automatic"
        onSelect={onSelect}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Code block language: Automatic",
      }),
    );
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith(PLAIN_TEXT_LANGUAGE);
  });

  it("preserves an unknown current value while searching or cancelling", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LanguageCombobox
        label="Code block language"
        value={null}
        currentLabel="Unknown: syntheticlang"
        onSelect={onSelect}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Code block language: Unknown: syntheticlang",
    });
    await user.click(trigger);
    const input = screen.getByRole("combobox", {
      name: "Search code block language",
    });
    await user.type(input, "python");
    await user.keyboard("{Escape}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("closes on Tab without trapping focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <LanguageCombobox
          label="Source language"
          value={AUTOMATIC_LANGUAGE}
          currentLabel="Automatic"
          onSelect={vi.fn()}
        />
        <button type="button">Next control</button>
      </>,
    );

    await user.click(
      screen.getByRole("button", { name: "Source language: Automatic" }),
    );
    await user.tab();

    expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("does not select while IME composition is active", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LanguageCombobox
        label="Source language"
        value={AUTOMATIC_LANGUAGE}
        currentLabel="Automatic"
        onSelect={onSelect}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Source language: Automatic" }),
    );

    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Search source language" }),
      { key: "Enter", isComposing: true },
    );

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports an empty filtered result without inventing an option", async () => {
    const user = userEvent.setup();
    render(
      <LanguageCombobox
        label="Source language"
        value={AUTOMATIC_LANGUAGE}
        currentLabel="Automatic"
        onSelect={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Source language: Automatic" }),
    );
    await user.type(
      screen.getByRole("combobox", { name: "Search source language" }),
      "not-a-language",
    );

    expect(screen.getByText("No supported languages match.")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});

describe("filterLanguageOptions", () => {
  it("keeps Automatic and Plain text first without a query", () => {
    expect(
      filterLanguageOptions(
        [
          { value: AUTOMATIC_LANGUAGE, label: "Automatic", searchTerms: [] },
          { value: PLAIN_TEXT_LANGUAGE, label: "Plain text", searchTerms: [] },
        ],
        "",
      ).map((option) => option.value),
    ).toEqual([AUTOMATIC_LANGUAGE, PLAIN_TEXT_LANGUAGE]);
  });
});
