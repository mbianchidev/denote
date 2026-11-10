import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { build } from "vite";
import { assertValidPluginCatalogEntry } from "@denote/plugin-sdk";
import catalogJson from "../plugins/catalog.json" with { type: "json" };
import type { PluginView } from "../src/types";
import { THEME_STORAGE_KEY } from "../src/lib/theme";

const plugins: PluginView[] = catalogJson.map((value) => {
  const catalog: unknown = value;
  assertValidPluginCatalogEntry(catalog);
  return {
    catalog, status: "not-installed", enabled: false, error: null,
    approvedPermissions: [], previouslyApproved: false, settings: {}, hasCredentials: false,
  };
});
let fixture = "";
test.beforeAll(async () => {
  const result = await build({
    configFile: false, logLevel: "error",
    build: { write: false, lib: { entry: "benchmarks/nativeFixture.ts", name: "syntheticAccessibilityFixture", formats: ["iife"] } },
  });
  const bundles = Array.isArray(result) ? result : [result];
  if (bundles.length !== 1 || !("output" in bundles[0])) throw new Error("Expected one accessibility fixture.");
  const chunk = bundles[0].output.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing accessibility fixture.");
  fixture = chunk.code;
});

async function audit(page: Page, info: TestInfo, name: string, selector?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (selector) builder = builder.include(selector);
  const result = await builder.analyze();
  await info.attach(name, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.violations.map((violation) => ({
    id: violation.id, help: violation.help, targets: violation.nodes.map((node) => node.target),
  }))).toEqual([]);
}

for (const variant of [
  { name: "dark desktop", theme: "dark", width: 1440, height: 1000 },
  { name: "light compact", theme: "light", width: 840, height: 700 },
]) {
test(`core and every catalog management surface pass WCAG checks through keyboard review in ${variant.name}`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: variant.width, height: variant.height });
  await page.addInitScript({ content:
    `localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(variant.theme)}); window.__DENOTE_SMALL_TREE__ = true; window.__DENOTE_PLUGIN_CATALOG__ = ${JSON.stringify(plugins)};\n${fixture}` });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", variant.theme);
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Small.md", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true })).toBeVisible();
  await audit(page, info, "Core workspace");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await audit(page, info, "Editor settings", ".editor-settings-dialog");
  await settings.getByRole("button", { name: "Security", exact: true }).focus();
  await page.keyboard.press("Enter");
  await audit(page, info, "Security settings", ".editor-settings-dialog");
  await settings.getByRole("button", { name: "Plugins", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(settings.locator(".plugin-card")).toHaveCount(plugins.length);
  await audit(page, info, "Plugin manager", ".editor-settings-dialog");

  for (const plugin of plugins) {
    const card = settings.locator(".plugin-card").filter({
      has: page.getByText(plugin.catalog.manifest.name, { exact: true }),
    });
    await card.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    for (const details of await card.locator("details").all()) {
      await details.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
    }
    await card.getByRole("button", { name: "Enable", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(card.getByRole("button", { name: "Approve and enable", exact: true })).toBeVisible();
    await audit(page, info, `${plugin.catalog.manifest.id} settings and permission review`, ".plugin-card[open]");
    await card.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Enter");
    await card.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
  }
  await settings.getByRole("button", { name: "Done", exact: true }).focus();
  await expect(settings.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
});
}

test("startup safe mode keeps approved code stopped while core editing and recovery remain usable", async ({ page }, info) => {
  const approved = { ...plugins[0], enabled: true, status: "enabled",
    approvedPermissions: plugins[0].catalog.manifest.permissions, previouslyApproved: true };
  await page.addInitScript({ content:
    `window.__DENOTE_SMALL_TREE__ = true; window.__DENOTE_SAFE_MODE__ = true; window.__DENOTE_PLUGIN_CATALOG__ = ${JSON.stringify([approved])};\n${fixture}` });
  await page.goto("/");
  await expect(page.getByText("Safe mode", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Small.md", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "editable markdown", exact: true });
  await expect(editor).toBeEditable();
  await editor.fill("Synthetic safe-mode recovery edit.");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_BENCHMARK__.documents["Small.md"]))
    .toContain("Synthetic safe-mode recovery edit.");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(settings.getByText("Paused in safe mode", { exact: true })).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Automatically update plugins" })).toBeDisabled();
  await expect(settings.getByRole("button", { name: "Disable all plugins", exact: true })).toBeEnabled();
  await audit(page, info, "Safe-mode recovery", ".editor-settings-dialog");
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
});
