import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { buildPlugin, pluginDirectories } from "../scripts/plugin-build";

let fixture = "";
let errors: string[] = [];
test.beforeAll(async () => {
  for (const id of ["denote.linter", "denote.compiler", "denote.terminal"]) await buildPlugin(pluginDirectories(id)[0]);
  const result = await build({ configFile: false, logLevel: "error",
    build: { write: false, lib: { entry: "benchmarks/toolingFixture.ts", name: "syntheticToolingFixture", formats: ["iife"] } } });
  const bundles = Array.isArray(result) ? result : [result];
  if (bundles.length !== 1 || !("output" in bundles[0])) throw new Error("Expected one tooling fixture bundle.");
  const chunk = bundles[0].output.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing tooling fixture.");
  fixture = chunk.code;
});
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript({ content: fixture });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "example.ts", exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.unexpectedCommands)).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.browserWindowOpens)).toEqual([]);
});

async function openSource(page: Page) {
  await page.getByRole("button", { name: "example.ts", exact: true }).click();
  await expect(page.locator(".cm-content:visible")).toBeVisible();
}
async function approve(page: Page, name: string, kind: "linter" | "build" | "terminal") {
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name, exact: true }).click();
  const panel = page.locator(".code-tool-panel:visible").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await panel.getByLabel(`Enable ${kind === "build" ? "build tool" : kind === "terminal" ? "shell" : "linter"}`, { exact: true }).check();
  await panel.getByRole("button", { name: "Choose executable", exact: true }).click();
  if (kind === "linter") {
    await panel.getByLabel("Output parser", { exact: true }).selectOption("eslint-json");
    await panel.getByLabel("Send current source through stdin", { exact: true }).check();
  }
  await panel.getByRole("button", { name: "Save and approve", exact: true }).click();
  await expect(panel.getByRole("button", { name: kind === "linter" ? "Run linter" : kind === "build" ? "Build" : "New terminal", exact: true })).toBeEnabled();
  return panel;
}

test("real linter worker, source markers, reviewed fixes and clean-run replacement stay version-bound", async ({ page }) => {
  await openSource(page);
  const panel = await approve(page, "Linter", "linter");
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.starts)).toEqual([]);
  await panel.getByRole("button", { name: "Run linter", exact: true }).click();
  await expect(panel.getByText("warning: Use single quotes.", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-lintRange-warning, .cm-lintPoint-warning")).toHaveCount(1);
  await expect(page.locator(".cm-lint-marker-warning")).toHaveCount(1);
  await panel.getByRole("button", { name: "Preview fix", exact: true }).click();
  await expect(panel.getByLabel("Source after fix", { exact: true })).toContainText("const demo = 'example';");
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.documents["example.ts"])).toBe('const demo = "example";\n');
  await panel.getByRole("button", { name: "Apply fix", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_TOOLING__.documents["example.ts"])).toBe("const demo = 'example';\n");
  await expect(page.locator(".cm-lintRange-warning, .cm-lintPoint-warning")).toHaveCount(0);
  await page.evaluate(() => { window.__DENOTE_TOOLING__.lintMode = "clean"; });
  await panel.getByRole("button", { name: "Run linter", exact: true }).click();
  await expect(panel.getByText("No current matching problems.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("status")).toContainText("Run finished.");
});

test("builds stream, cancel, require saved-content consent and stay failed after compiler errors", async ({ page }) => {
  await openSource(page);
  const panel = await approve(page, "Build and compiler", "build");
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.starts)).toEqual([]);
  await page.evaluate(() => { window.__DENOTE_TOOLING__.blockSaves = true; window.__DENOTE_TOOLING__.holdBuild = true; });
  await page.locator(".cm-content:visible").fill("const unsaved = 2;\n");
  await expect(panel.getByText(/1 unsaved file/)).toBeVisible();
  await panel.getByRole("button", { name: "Run on saved files", exact: true }).click();
  await expect(panel.getByLabel("Standard output", { exact: true })).toContainText("Building synthetic source");
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.starts[0].input)).toBeNull();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Run cancelled.");
  await page.evaluate(() => { window.__DENOTE_TOOLING__.failSaves = true; window.__DENOTE_TOOLING__.releaseSaves(); });
  await panel.getByRole("button", { name: "Save all and build", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("No tool was started");
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.starts.length)).toBe(1);
  await page.evaluate(() => { window.__DENOTE_TOOLING__.failSaves = false; window.__DENOTE_TOOLING__.holdBuild = false; });
  await panel.getByRole("button", { name: "Save all and build", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Run failed (exit 2).");
  await expect(panel.getByText("error: Example compiler error.", { exact: true })).toBeVisible();
  await panel.getByLabel("Severity", { exact: true }).selectOption("error");
  await expect(panel.locator(".code-tool-list > li")).toHaveCount(1);
  await panel.getByRole("button", { name: /error: Example compiler error/ }).click();
  await expect(page.locator(".cm-content:visible")).toContainText("const unsaved = 2;");
});

test("Ghostty uses real bundled WASM, Unicode, keyboard escape, search, copy and close confirmation", async ({ page }) => {
  await openSource(page);
  const panel = await approve(page, "Ghostty terminal", "terminal");
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.starts)).toEqual([]);
  await panel.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "Terminal 1", exact: true })).toBeVisible();
  await expect(panel.locator("canvas")).toBeVisible();
  await panel.getByText("Text output and links", { exact: true }).click();
  await expect(panel.getByLabel("Terminal text output", { exact: true })).toContainText("Invented λ terminal");
  const input = panel.getByRole("textbox", { name: "Terminal 1 input", exact: true });
  await input.focus();
  await page.keyboard.type("echo");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_TOOLING__.input.join(""))).toContain("echo");
  await page.keyboard.press("Tab");
  await expect(panel.getByLabel("Search terminal", { exact: true })).toBeFocused();
  await panel.getByLabel("Search terminal", { exact: true }).fill("Invented");
  await panel.getByRole("button", { name: "Search output", exact: true }).click();
  await expect(panel.getByText("1 matching lines.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_TOOLING__.copies.join(""))).toContain("Invented");
  await panel.getByRole("button", { name: "Close terminal", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Close Terminal 1?", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("contentinfo").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "Terminal 1", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close terminal", exact: true }).click();
  await page.getByRole("dialog", { name: "Close Terminal 1?", exact: true }).getByRole("button", { name: "Terminate and close", exact: true }).click();
  await expect(panel.getByText("No terminal is running.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.stops)).toContain("synthetic-run-1");
});

test("unsupported Windows PTYs remain explicit and never launch a shell", async ({ page }) => {
  await page.evaluate(() => { window.__DENOTE_TOOLING__.platform = "windows"; });
  await openSource(page);
  await page.getByRole("button", { name: "Ghostty terminal", exact: true }).click();
  const panel = page.locator(".terminal-panel:visible");
  await expect(panel.getByText("Windows PTY process-tree shutdown is not yet verified.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "New terminal", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__DENOTE_TOOLING__.starts)).toEqual([]);
});
