import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMOJI_MAX_FAVORITES, EMOJI_MAX_RECENTS } from "@denote/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { EmojiHostSurface } from "./EmojiPicker";
import { syntheticEmojiHost } from "../lib/emoji.testFixtures";

function openPicker(fixture = syntheticEmojiHost()) {
  const insert = vi.fn(() => true);
  const restore = vi.fn();
  const adapter = {
    scope: fixture.binding.scope,
    element: () => null,
    capture: () => ({ valid: () => true, insert, restore }),
  };
  fixture.host.register(adapter);
  fixture.host.activate(adapter);
  render(<EmojiHostSurface host={fixture.host} />);
  act(() => fixture.host.open(fixture.picker));
  return { ...fixture, insert, restore };
}

describe("host emoji picker", () => {
  it.each(["recents", "favorites"] as const)("retains the SDK %s limit without applying a smaller UI quota", (collection) => {
    const fixture = syntheticEmojiHost();
    const limit = collection === "recents" ? EMOJI_MAX_RECENTS : EMOJI_MAX_FAVORITES;
    fixture.picker.entries = Array.from({ length: limit + 1 }, (_, index) => ({
      ...fixture.picker.entries[0],
      id: `synthetic-${index}`,
      name: `Synthetic emoji ${index}`,
      unicode: String.fromCodePoint(index < 80 ? 0x1f600 + index : 0x1f680 + index - 80),
    }));
    const count = collection === "recents" ? limit : limit - 1;
    const values = fixture.picker.entries.slice(0, count).map((entry) => entry.unicode);
    const preferences = { recents: [] as string[], favorites: [] as string[], tone: 0, [collection]: values };
    fixture.host.configure({ ...fixture.config, preferences: () => preferences });
    openPicker(fixture);
    const selected = fixture.picker.entries[count];
    fireEvent.change(screen.getByRole("textbox", { name: "Search emoji" }), { target: { value: selected.name } });
    fireEvent.click(screen.getByRole("button", {
      name: collection === "recents" ? `Insert ${selected.name}` : `Add ${selected.name} to favorites`,
    }));
    expect(fixture.save).toHaveBeenLastCalledWith(fixture.picker, {
      ...preferences,
      [collection]: collection === "recents" ? [selected.unicode, ...values.slice(0, -1)] : [...values, selected.unicode],
    });
  });
  it("focuses search, searches locally, selects Unicode and stores recents", async () => {
    const user = userEvent.setup();
    const fixture = openPicker();
    expect(screen.getByRole("textbox", { name: "Search emoji" })).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: "Search emoji" }), "computer");
    await user.click(screen.getByRole("button", { name: "Insert Technologist" }));
    expect(fixture.insert).toHaveBeenCalledWith("🧑‍💻");
    expect(fixture.save).toHaveBeenCalledWith(fixture.picker, { recents: ["🧑‍💻"], favorites: [], tone: 0 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("offers favorites and named skin-tone variants", async () => {
    const user = userEvent.setup();
    const fixture = openPicker();
    await user.type(screen.getByRole("textbox", { name: "Search emoji" }), "wave");
    await user.selectOptions(screen.getByLabelText("Skin tone"), "5");
    expect(screen.getByRole("button", { name: "Insert Waving hand dark" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Waving hand dark to favorites" }));
    await user.selectOptions(screen.getByLabelText("Show"), "favorites");
    expect(screen.getByRole("button", { name: "Insert Waving hand dark" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Insert emoji" }));
    expect(fixture.insert).toHaveBeenCalledWith("👋🏿");
  });
  it("inserts a named non-tone standardized variant unchanged", async () => {
    const user = userEvent.setup();
    const fixture = openPicker();
    expect(screen.getByRole("dialog", { name: "Emoji picker" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search emoji" }), "computer");
    await user.selectOptions(screen.getByLabelText("Variant"), "👩‍💻");
    await user.click(screen.getByRole("button", { name: "Insert emoji" }));
    expect(fixture.insert).toHaveBeenCalledWith("👩‍💻");
    expect(fixture.save).toHaveBeenLastCalledWith(fixture.picker, {
      recents: ["👩‍💻"], favorites: [], tone: 0,
    });
  });
  it("announces no results and restores selection on Escape", async () => {
    const user = userEvent.setup();
    const fixture = openPicker();
    await user.type(screen.getByRole("textbox", { name: "Search emoji" }), "missing");
    expect(screen.getByRole("status")).toHaveTextContent("No emoji found");
    await user.keyboard("{Escape}");
    expect(fixture.restore).toHaveBeenCalledOnce();
  });
  it("uses arrow and Home/End navigation and ignores composing Enter", async () => {
    const user = userEvent.setup();
    const fixture = openPicker();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    expect(fixture.insert).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}{End}{Enter}");
    expect(fixture.insert).toHaveBeenCalledWith("🧑‍💻");
  });
  it("removes an open picker immediately on contribution disposal", () => {
    const fixture = openPicker();
    act(() => fixture.disable());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.insert).not.toHaveBeenCalled();
  });
  it("pages results instead of mounting thousands of buttons", () => {
    const fixture = syntheticEmojiHost();
    fixture.picker.entries = Array.from({ length: 100 }, (_, index) => ({
      ...fixture.picker.entries[0], id: `synthetic-${index}`, unicode: String.fromCodePoint(0x1f600 + index),
    }));
    const adapter = { scope: fixture.binding.scope, element: () => null, capture: () => ({ valid: () => true, insert: () => true, restore: () => {} }) };
    fixture.host.register(adapter); fixture.host.activate(adapter);
    render(<EmojiHostSurface host={fixture.host} />);
    act(() => fixture.host.open(fixture.picker));
    expect(within(screen.getByRole("list", { name: "Emoji results" })).getAllByRole("button")).toHaveLength(48);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("status")).toHaveTextContent("Page 2 of 3");
  });
});
