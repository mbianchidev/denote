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
    deviceAuthentication: { available: true, name: "Synthetic device", unavailableReason: null },
  };
  await page.addInitScript({ content: `window.__DENOTE_APP_LOCK__ = ${JSON.stringify(status)};\n${fixture}` });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Denote is locked" })).toBeVisible();
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.vaultReads)).toBe(0);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.noteReads)).toBe(0);

  await page.getByRole("button", { name: "Unlock with Synthetic device" }).click();
  await expect(page.getByRole("alert")).toHaveText("Device authentication was cancelled.");
  await expect(page.getByRole("heading", { name: "Denote is locked" })).toBeVisible();
  await page.getByLabel("App password").fill("synthetic wrong password");
  await page.getByLabel("App password").press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Incorrect app password.");
  await expect(page.getByLabel("App password")).toHaveValue("");
  await page.getByLabel("App password").fill("synthetic app password");
  await page.getByLabel("App password").press("Enter");
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Small.md", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true })).toContainText("Small synthetic page");
  await page.getByRole("button", { name: "Lock app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Denote is locked" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true })).toHaveCount(0);
  await expect(page.getByText("Small synthetic page", { exact: true })).toHaveCount(0);
  await info.attach("App lock", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "Unlock with Synthetic device" }).click();
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.appLock.inactivityMinutes)).toBeNull();
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
