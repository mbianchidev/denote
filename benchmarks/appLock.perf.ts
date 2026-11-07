import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { AppLockStatus } from "../src/types";

let fixture = "";
test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      lib: { entry: "benchmarks/nativeFixture.ts", name: "syntheticAppLockFixture", formats: ["iife"] },
    },
  });
  const bundles = Array.isArray(bundle) ? bundle : [bundle];
  if (bundles.length !== 1 || !("output" in bundles[0])) throw new Error("Expected one app-lock fixture bundle.");
  const entry = bundles[0].output.find((output) => output.type === "chunk");
  if (!entry || entry.type !== "chunk") throw new Error("Missing app-lock fixture entrypoint.");
  fixture = entry.code;
});

test("production app lock gates startup, handles cancellation, and withdraws private editors", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const status: AppLockStatus = {
    enabled: true, locked: true, passwordEnabled: true, deviceAuthenticationEnabled: true,
    inactivityMinutes: null,
    deviceAuthentication: { available: true, name: "Touch ID", unavailableReason: null },
  };
  await page.addInitScript({ content: `window.__DENOTE_APP_LOCK__ = ${JSON.stringify(status)};\n${fixture}` });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Denote is locked" })).toBeVisible();
  await expect(page.getByText(/vault encryption/i)).toHaveCount(0);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.vaultReads)).toBe(0);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.noteReads)).toBe(0);

  await page.getByRole("button", { name: "Unlock with Touch ID" }).click();
  await expect(page.getByRole("alert")).toHaveText("Device authentication was cancelled.");
  await expect(page.getByRole("heading", { name: "Denote is locked" })).toBeVisible();
  await page.getByLabel("App password").fill("synthetic wrong password");
  await page.getByLabel("App password").press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Incorrect app password.");
  await expect(page.getByLabel("App password")).toHaveValue("");
  await page.getByLabel("App password").fill("synthetic app password");
  await page.getByLabel("App password").press("Enter");
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Security", exact: true }).click();
  await expect(settings.getByRole("checkbox", { name: "App password", exact: true })).toBeChecked();
  await expect(settings.getByRole("checkbox", { name: "Touch ID", exact: true })).toBeChecked();
  await expect(settings.getByLabel("Lock after inactivity")).toHaveValue("");
  const settingsImage = info.outputPath("security-settings.png");
  await settings.screenshot({ path: settingsImage });
  await info.attach("Security settings", { path: settingsImage, contentType: "image/png" });
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Small.md", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true })).toContainText("Small synthetic page");
  await page.getByRole("button", { name: "Lock app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Denote is locked" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true })).toHaveCount(0);
  await expect(page.getByText("Small synthetic page", { exact: true })).toHaveCount(0);
  const lockImage = info.outputPath("app-lock.png");
  await page.screenshot({ path: lockImage });
  await info.attach("App lock", { path: lockImage, contentType: "image/png" });
  await page.getByRole("button", { name: "Unlock with Touch ID" }).click();
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.appLock.inactivityMinutes)).toBeNull();
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Security settings show password setup with inactivity locking disabled", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const status: AppLockStatus = {
    enabled: false, locked: false, passwordEnabled: false, deviceAuthenticationEnabled: false,
    inactivityMinutes: null,
    deviceAuthentication: { available: true, name: "Touch ID", unavailableReason: null },
  };
  await page.addInitScript({ content: `window.__DENOTE_APP_LOCK__ = ${JSON.stringify(status)};\n${fixture}` });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Security", exact: true }).click();
  await settings.getByRole("checkbox", { name: "Enable app lock", exact: true }).check();
  await expect(settings.getByLabel("New app password")).toHaveValue("");
  await expect(settings.getByLabel("Confirm app password")).toHaveValue("");
  await expect(settings.getByLabel("Lock after inactivity")).toHaveValue("");
  const setupImage = info.outputPath("app-lock-setup.png");
  await settings.screenshot({ path: setupImage });
  await info.attach("App lock setup", { path: setupImage, contentType: "image/png" });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
});
