import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { buildPlugin, pluginDirectories } from "../scripts/plugin-build";

let fixture = "";
let errors: string[] = [];
test.beforeAll(async () => {
  for (const id of ["denote.text-styling", "denote.note-comments", "denote.presentations", "denote.speech", "denote.credential-store"]) {
    await buildPlugin(pluginDirectories(id)[0]);
  }
  const result = await build({
    configFile: false, logLevel: "error",
    build: { write: false, lib: { entry: "benchmarks/authoringFixture.ts", name: "syntheticAuthoringFixture", formats: ["iife"] } },
  });
  const bundles = Array.isArray(result) ? result : [result];
  if (bundles.length !== 1 || !("output" in bundles[0])) throw new Error("Expected one authoring fixture bundle");
  const chunk = bundles[0].output.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing authoring fixture");
  fixture = chunk.code;
});
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript({ content: fixture });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Authoring.md", exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.unexpectedCommands)).toEqual([]);
});

async function selectRichText(page: Page, phrase: string) {
  await page.getByRole("textbox", { name: "editable markdown", exact: true }).focus();
  await page.getByText("A short phrase for review.", { exact: true }).evaluate((element, phrase) => {
    const node = element.firstChild;
    if (!node?.textContent) throw new Error("Missing synthetic text node");
    const from = node.textContent.indexOf(phrase);
    if (from < 0) throw new Error("Missing synthetic selection");
    const range = document.createRange();
    range.setStart(node, from); range.setEnd(node, from + phrase.length);
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, phrase);
}

test("Rich edits and autosave preserve literal equals signs, trailing spaces, tabs, and hard breaks", async ({ page }) => {
  const source = "= literal. \t\n\nKept. \n\nHard break.  \nNext line.\t\n\nEdit here";
  await page.evaluate((source) => { window.__DENOTE_AUTHORING__.documents["Authoring.md"] = source; }, source);
  await page.getByRole("button", { name: "Authoring.md", exact: true }).click();
  const rich = page.getByRole("textbox", { name: "editable markdown", exact: true });
  await expect(rich).toBeVisible();
  await rich.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type("!");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(`${source}!`);
  await page.getByRole("radio", { name: "Source mode", exact: true }).click();
  await expect.poll(() => page.locator(".markdown-editor-shell .cm-content:visible .cm-line").allTextContents()).toEqual(`${source}!`.split("\n"));
  await page.getByRole("radio", { name: "Rich text", exact: true }).click();
  await rich.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(". ");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(`${source}!. `);
  await page.getByRole("radio", { name: "Source mode", exact: true }).click();
  await expect.poll(() => page.locator(".markdown-editor-shell .cm-content:visible .cm-line").allTextContents()).toEqual(`${source}!. `.split("\n"));
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const marker of ["-", "+", "*"]) {
  test(`Rich editing retains underscore emphasis and ${marker} list markers, including new items`, async ({ page }) => {
    const source = `_An invented italic sentence._\n\n${marker} First synthetic item\n${marker} Second synthetic item`;
    await page.evaluate((source) => { window.__DENOTE_AUTHORING__.documents["Authoring.md"] = source; }, source);
    await page.getByRole("button", { name: "Authoring.md", exact: true }).click();
    const italic = page.getByRole("textbox", { name: "editable markdown", exact: true }).locator("em").first();
    await expect(italic).toHaveText("An invented italic sentence.");
    await page.getByText("Second synthetic item", { exact: true }).click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
    await page.keyboard.type("!");
    await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(`${source}!`);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third synthetic item");
    const expected = `${source}!\n${marker} Third synthetic item`;
    await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(expected);
    await page.getByRole("radio", { name: "Source mode", exact: true }).click();
    await expect.poll(() => page.locator(".markdown-editor-shell .cm-content:visible .cm-line").allTextContents()).toEqual(expected.split("\n"));
    await page.getByRole("radio", { name: "Rich text", exact: true }).click();
    await expect(italic).toHaveText("An invented italic sentence.");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("real approved workers format exact source and keep comments portable through orphan recovery", async ({ page }) => {
  await page.getByRole("button", { name: "Authoring.md", exact: true }).click();
  await expect(page.locator(".denote-text-style").filter({ hasText: "Existing excerpt" })).toBeVisible();
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]);
  await selectRichText(page, "short phrase");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
  await page.getByRole("combobox", { name: "Search commands or filenames across vaults" }).fill("Text style");
  await page.getByRole("option", { name: /Text style/ }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Text style");
  await page.getByRole("combobox", { name: "Color", exact: true }).selectOption("green");
  await page.getByRole("button", { name: "Apply style", exact: true }).click();
  const styled = original.replace("short phrase", "=green=short phrase=green=");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(styled);
  await page.locator(".denote-text-style").filter({ hasText: "short phrase" }).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await page.getByLabel("Comment", { exact: true }).fill("An invented local comment.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.comments.document.notes["Authoring.md"]?.length)).toBe(1);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.comments.document.notes["Authoring.md"][0].anchor?.quote)).toBe("short phrase");
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Source mode", exact: true }).click();
  const editor = page.locator(".markdown-editor-shell .cm-content");
  await editor.fill(`${styled}\nshort phrase\n`);
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(`${styled}\nshort phrase\n`);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.getByText("Orphaned: ambiguous text", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Attach to", exact: true }).selectOption("note");
  await page.getByRole("button", { name: "Attach to whole note", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.comments.document.notes["Authoring.md"][0].anchor)).toBeNull();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(`${styled}\nshort phrase\n`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("checkbox", { name: "Notes with highlights", exact: true }).check();
  await expect(page.locator(".search-result")).toHaveCount(2);
});

test("presentation source, full-screen navigation, autoplay and return release resources without rewriting", async ({ page }) => {
  await page.getByRole("button", { name: "Deck.md", exact: true }).click();
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"]);
  await page.getByRole("button", { name: "Open as presentation", exact: true }).click();
  await expect(page.getByText("Slide 1 of 2", { exact: true })).toBeVisible();
  await expect(page.locator(".presentation-slide")).toContainText("First slide");
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect(page.getByRole("button", { name: "Exit presentation", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Presentation", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await expect(page.locator(".presentation-slide")).toContainText("const example = 1;");
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await page.getByRole("button", { name: "Return to note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open as presentation", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"])).toBe(original);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.saves)).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the grey sidebar badge follows only the active note's open comments", async ({ page }, info) => {
  const rail = page.locator(".activity-rail");
  const comments = rail.getByRole("button", { name: /^Note comments(?:,|$)/ });
  const badge = rail.locator(".activity-rail__badge--muted");
  await page.getByRole("button", { name: "Authoring.md", exact: true }).click();
  await expect(rail.getByRole("button", { name: "Speech", exact: true })).toBeVisible();
  await expect(page.locator(".denote-text-style")).toBeVisible();
  await expect(comments).toBeEnabled();
  await expect(badge).toHaveCount(0);
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]);
  await selectRichText(page, "short phrase");
  await comments.click();
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("Review this synthetic phrase.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(badge).toHaveText("1");
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.comments.document.notes["Authoring.md"][0].anchor?.quote)).toBe("short phrase");
  await page.keyboard.press("Escape");
  await expect(comments).toHaveAccessibleName("Note comments, 1 open comment");
  await page.getByRole("button", { name: "Deck.md", exact: true }).click();
  await expect(badge).toHaveCount(0);
  await page.getByRole("button", { name: "Open as presentation", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await comments.click();
  await expect(page.getByRole("dialog", { name: "Comments", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to note", exact: true }).click();
  await page.getByRole("button", { name: "Authoring.md", exact: true }).click();
  await expect(comments).toHaveAccessibleName("Note comments, 1 open comment");
  await comments.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Resolve comment", exact: true }).click();
  await expect(badge).toHaveCount(0);
  await page.getByRole("combobox", { name: "Show comments", exact: true }).selectOption("resolved");
  await page.getByRole("button", { name: "Reopen comment", exact: true }).click();
  await expect(badge).toHaveText("1");
  await page.getByRole("combobox", { name: "Show comments", exact: true }).selectOption("open");
  await page.getByRole("button", { name: "Delete comment", exact: true }).click();
  await page.getByRole("group", { name: "Delete this comment?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(badge).toHaveCount(0);
  await page.getByRole("combobox", { name: "Attach to", exact: true }).selectOption("note");
  for (const [index, body] of ["Check this invented example.", "Review the synthetic heading."].entries()) {
    await page.getByRole("textbox", { name: "Comment", exact: true }).fill(body);
    await page.getByRole("button", { name: "Add comment", exact: true }).click();
    await expect(badge).toHaveText(String(index + 1));
  }
  await page.keyboard.press("Escape");
  await expect(comments).toHaveAccessibleName("Note comments, 2 open comments");
  const reads = await page.evaluate(() => window.__DENOTE_AUTHORING__.commentReads);
  for (const theme of ["dark", "light"]) {
    if (theme === "light") {
      await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
      await page.setViewportSize({ width: 840, height: 700 });
    }
    const colors = await badge.evaluate((element) => {
      const style = getComputedStyle(element);
      const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const background = rgb(style.backgroundColor);
      const luminance = (channels: number[]) => channels.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
      const light = luminance(rgb(style.color));
      const dark = luminance(background);
      return {
        spread: Math.max(...background) - Math.min(...background),
        contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      };
    });
    expect(colors.spread).toBeLessThanOrEqual(20);
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: info.outputPath(`comment-badge-${theme}.png`) });
  }
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.commentReads)).toBe(reads);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const card = page.locator(".plugin-card").filter({ has: page.getByText("Note comments", { exact: true }) });
  await card.locator("summary").first().click();
  await card.getByRole("button", { name: "Disable and remove code", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(comments).toHaveCount(0);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(original);
});

test("overview preserves unknown frontmatter and disabling a live provider releases its worker", async ({ page }) => {
  await page.getByRole("button", { name: "Deck.md", exact: true }).click();
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"]);
  await page.getByRole("button", { name: "Open as presentation", exact: true }).click();
  await expect(page.getByText("Slide 1 of 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Move slide 1 later", exact: true }).click();
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await expect(page.locator(".presentation-slide")).toContainText("First slide");
  await expect.poll(() => page.evaluate(() => {
    const source = window.__DENOTE_AUTHORING__.documents["Deck.md"];
    return source.indexOf("# Second slide") < source.indexOf("# First slide");
  })).toBe(true);
  const reordered = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"]);
  const preamble = original.slice(0, original.indexOf("# "));
  expect(reordered.slice(0, preamble.length)).toBe(preamble);
  const workers = await page.evaluate(() => window.__DENOTE_AUTHORING__.terminatedWorkers);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const card = page.locator(".plugin-card").filter({ has: page.getByText("Markdown presentation slides", { exact: true }) });
  await card.locator("summary").first().click();
  await card.getByRole("button", { name: "Disable and remove code", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.terminatedWorkers)).toBeGreaterThan(workers);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open as presentation", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"])).toBe(reordered);
});

test("native fullscreen fallback owns focus and restores the prior window state", async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false }));
  await page.getByRole("button", { name: "Deck.md", exact: true }).click();
  await page.getByRole("button", { name: "Open as presentation", exact: true }).click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Full-screen presentation", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.nativeFullscreen)).toBe(true);
  await page.keyboard.press("End");
  await expect(page.getByText("Slide 2 of 2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Full-screen presentation", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.nativeFullscreen)).toBe(false);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.saves)).toEqual([]);
});

test("dash-separated slides keep Markdown formatting and aligned keyboard playback controls", async ({ page }, info) => {
  await page.getByRole("button", { name: "Deck.md", exact: true }).click();
  await page.getByRole("button", { name: "Open as presentation", exact: true }).click();
  await expect(page.getByText("Slide 1 of 2", { exact: true })).toBeVisible();
  const source = [
    "# Presentations using Slides", "", "A demo on how to build presentations using Slides.", "", "---", "",
    "## Formatting", "", "You can use regular Markdown formatting, like *emphasised* and **bold** text.", "", "---", "",
    "## Slides", "", "Use `---` to separate slides.", "",
  ].join("\n");
  await page.locator(".presentation-source .cm-content").focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  await page.keyboard.insertText(source);
  await expect(page.getByText(/Slide \d of 3/, { exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false }));
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".presentation-slide em")).toHaveText("emphasised");
  await expect(page.locator(".presentation-slide strong")).toHaveText("bold");
  const loop = page.getByRole("checkbox", { name: "Loop", exact: true });
  const geometry = await loop.evaluate((input) => {
    const label = input.closest("label");
    if (!label?.lastChild) throw new Error("Missing Loop label");
    const bounds = input.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(label.lastChild);
    const text = range.getBoundingClientRect();
    return {
      padding: getComputedStyle(input).padding,
      margin: getComputedStyle(input).margin,
      width: bounds.width,
      height: bounds.height,
      labelHeight: label.getBoundingClientRect().height,
      centerDifference: Math.abs(bounds.y + bounds.height / 2 - text.y - text.height / 2),
    };
  });
  expect(geometry.padding).toBe("0px");
  expect(geometry.margin).toBe("0px");
  expect(geometry.width).toBe(15);
  expect(geometry.height).toBe(15);
  expect(geometry.labelHeight).toBeGreaterThanOrEqual(28);
  expect(geometry.centerDifference).toBeLessThan(2);
  await loop.focus();
  await page.keyboard.press("Space");
  await expect(loop).toBeChecked();
  await page.screenshot({ path: info.outputPath("playback-dark-desktop.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  const outlineToggle = page.getByRole("button", { name: /^(Hide|Show) outline$/ });
  if (await outlineToggle.getAttribute("aria-pressed") === "true") await outlineToggle.click();
  await page.setViewportSize({ width: 840, height: 700 });
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit presentation", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("playback-light-compact.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Return to note", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"])).toBe(source);
});

test("authoring surfaces retain accessible dark, light, and compact layouts", async ({ page }, info) => {
  await page.getByRole("button", { name: "Authoring.md", exact: true }).click();
  await expect(page.locator(".denote-text-style")).toBeVisible();
  await selectRichText(page, "short phrase");
  await page.getByRole("button", { name: "Text style", exact: true }).click();
  await page.screenshot({ path: info.outputPath("styles-dark-desktop.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await page.setViewportSize({ width: 840, height: 700 });
  await page.getByRole("button", { name: "Text style", exact: true }).click();
  await page.screenshot({ path: info.outputPath("styles-light-compact.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Comment", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("comments-light-compact.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await page.getByRole("button", { name: "Hide outline", exact: true }).click();
  await page.getByRole("button", { name: "Deck.md", exact: true }).click();
  await page.getByRole("button", { name: "Open as presentation", exact: true }).click();
  const source = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"]);
  await page.locator(".presentation-source .cm-content").fill(source.replace("presentation:\n", "presentation:\n  theme: light\n"));
  await expect(page.locator(".presentation-stage")).toHaveAttribute("data-slide-theme", "light");
  await page.evaluate(() => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false }));
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.keyboard.press("End");
  await expect(page.locator(".presentation-slide")).toContainText("Second slide");
  await expect(page.getByRole("img", { name: "Synthetic circle", exact: true })).toBeVisible();
  expect(await page.locator(".presentation-stage").evaluate((element) => getComputedStyle(element).getPropertyValue("--accent").trim())).toBe("#537642");
  const frame = await page.locator(".presentation-slide-frame").boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 2);
  await expect(page.getByRole("button", { name: "Exit presentation", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("slides-light-native-compact.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
