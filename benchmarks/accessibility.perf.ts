import { expect, test } from "@playwright/test";
import { build } from "vite";
import { assertValidPluginCatalogEntry } from "@denote/plugin-sdk";
import catalogJson from "../plugins/catalog.json" with { type: "json" };
import type { PluginView } from "../src/types";
import { THEME_STORAGE_KEY } from "../src/lib/theme";
import { auditAccessibility as audit } from "./accessibility";

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

test("remote image requests require explicit opt-in and revocation survives restart without editing source", async ({ page }) => {
  const requests: string[] = [];
  const referrers: string[] = [];
  const source = [
    "# Synthetic image privacy", "",
    "![Synthetic Markdown image](https://images.example.test/markdown.svg)", "",
    '<p><img src="https://images.example.test/html.svg" alt="Synthetic HTML image"></p>', "",
    "![Synthetic local image](assets/local.svg)", "",
  ].join("\n");
  await page.route("https://images.example.test/**", async (route) => {
    requests.push(route.request().url());
    const referrer = route.request().headers().referer;
    if (referrer) referrers.push(referrer);
    await route.fulfill({ contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="green"/></svg>' });
  });
  await page.addInitScript({ content:
    `window.__DENOTE_SMALL_TREE__ = true; window.__DENOTE_REMOTE_IMAGE_NOTE__ = ${JSON.stringify(source)};\n${fixture}` });
  const openNote = async () => {
    await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Small.md", exact: true }).click();
    await expect(page.getByRole("img", { name: /^Synthetic Markdown image/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Synthetic HTML image/ })).toBeVisible();
    await expect(page.getByRole("img", { name: "Synthetic local image", exact: true })).toBeVisible();
  };
  const setPermission = async (enabled: boolean) => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    await settings.getByRole("checkbox", { name: /^Load remote images\b/ }).setChecked(enabled);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
  };

  await page.goto("/");
  await openNote();
  await expect(page.locator('img[src^="https://"], img[src^="http://"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await setPermission(true);
  await expect.poll(() => [...new Set(requests)].sort()).toEqual([
    "https://images.example.test/html.svg", "https://images.example.test/markdown.svg",
  ]);
  await setPermission(false);
  await expect(page.locator('img[src^="https://"], img[src^="http://"]')).toHaveCount(0);
  const approvedRequests = requests.length;
  await page.reload();
  await openNote();
  await expect(page.locator('img[src^="https://"], img[src^="http://"]')).toHaveCount(0);
  expect(requests).toHaveLength(approvedRequests);
  expect(referrers).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.documents["Small.md"])).toBe(source);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.saves)).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
});
