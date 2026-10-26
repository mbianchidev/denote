import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { buildPlugin, pluginDirectories } from "../scripts/plugin-build";

let fixture = "";
let errors: string[] = [];
test.beforeAll(async () => {
  for (const id of ["denote.text-styling", "denote.note-comments", "denote.presentations"]) {
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
