import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "vite";
import { buildPlugin, pluginDirectories } from "../scripts/plugin-build";

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--mute-audio"] },
  permissions: ["microphone"],
});
test.setTimeout(60000);
let fixture = "";
let errors: string[] = [];
const primary = process.platform === "darwin" ? "Meta" : "Control";

test.beforeAll(async () => {
  for (const id of ["denote.text-styling", "denote.note-comments", "denote.presentations", "denote.speech", "denote.credential-store"]) {
    await buildPlugin(pluginDirectories(id)[0]);
  }
  const result = await build({
    configFile: false, logLevel: "error",
    build: { write: false, lib: { entry: "benchmarks/authoringFixture.ts", name: "syntheticSensitiveFixture", formats: ["iife"] } },
  });
  const bundles = Array.isArray(result) ? result : [result];
  if (bundles.length !== 1 || !("output" in bundles[0])) throw new Error("Expected one synthetic sensitive fixture");
  const chunk = bundles[0].output.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing synthetic sensitive fixture");
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

async function tabTo(page: Page, target: Locator) {
  await target.waitFor({ state: "visible" });
  const backwards = await target.evaluate((element) =>
    Boolean(document.activeElement && element.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING));
  const visited = new Set<string>();
  for (let count = 0; count < 120; count++) {
    if (!await target.count()) throw new Error("The keyboard target disappeared before focus could reach it.");
    if (await target.evaluate((element) => element === document.activeElement)) return;
    visited.add(await page.evaluate(() => {
      const active = document.activeElement;
      return `${active?.tagName}:${active?.getAttribute("role") ?? ""}:${active?.getAttribute("aria-label") ?? ""}`;
    }));
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  throw new Error(`Could not reach ${await target.getAttribute("aria-label") ?? await target.textContent()} by Tab. Focus path: ${[...visited].join(", ")}`);
}

async function command(page: Page, text: string) {
  await page.keyboard.press(`${primary}+p`);
  await expect(page.getByRole("combobox", { name: "Search commands or filenames across vaults" })).toBeFocused();
  await page.keyboard.type(text);
  await expect(page.getByRole("option").filter({ hasText: text }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Command palette", exact: true })).toHaveCount(0);
}

async function sourceCaret(page: Page) {
  await command(page, "Authoring.md");
  await expect(page.getByRole("navigation", { name: "Workspace views" }).getByRole("button", { name: "Speech", exact: true })).toBeVisible();
  await expect(page.locator(".denote-text-style")).toBeVisible();
  await tabTo(page, page.getByRole("radio", { name: "Bold", exact: true }));
  const source = page.getByRole("radio", { name: "Source mode", exact: true });
  await page.keyboard.press("End");
  await expect(source).toBeFocused();
  await page.keyboard.press("Space");
  const editor = page.locator(".markdown-editor-shell .cm-content:visible");
  await expect(editor).toHaveCount(1);
  await tabTo(page, editor);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
}

test("keyboard-only capture uses the real audio worklet, saves a portable voice link, and removal retains every byte", async ({ page }) => {
  await sourceCaret(page);
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]);
  await command(page, "Speech");
  await expect(page.getByRole("region", { name: "Speech", exact: true })).toBeVisible();
  const start = page.getByRole("button", { name: "Start recording", exact: true });
  await tabTo(page, start); await page.keyboard.press("Enter");
  await expect(page.getByText("Recording microphone audio", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/0:0[1-9]/);
  await page.keyboard.press("Escape");
  const save = page.getByRole("button", { name: "Save voice note", exact: true });
  await expect(save).toBeVisible();
  await expect(save).toBeFocused();
  const play = page.getByRole("button", { name: "Play audio: Recorded or imported audio", exact: true });
  await tabTo(page, play); await page.keyboard.press("Enter");
  const seek = page.getByRole("slider", { name: "Seek audio: Recorded or imported audio", exact: true });
  await expect(seek).toBeEnabled();
  await tabTo(page, seek); await page.keyboard.press("End");
  const volume = page.getByRole("slider", { name: "Audio volume: Recorded or imported audio", exact: true });
  await tabTo(page, volume); await page.keyboard.press("ArrowLeft");
  await expect(volume).toHaveValue("0.95");
  const speed = page.getByRole("slider", { name: "Playback speed: Recorded or imported audio", exact: true });
  await tabTo(page, speed);
  await page.keyboard.press("End");
  await expect(speed).toHaveValue("2");
  await tabTo(page, save);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.speechActions)).toContain("save");
  const saved = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]);
  expect(saved.replace(/\[Voice note\]\(assets\/synthetic-voice-1\.wav\)/, "")).toBe(original);
  const audio = await page.evaluate(() => window.__DENOTE_AUTHORING__.audio);
  expect(Object.keys(audio)).toEqual(["assets/synthetic-voice-1.wav"]);
  expect(atob(audio["assets/synthetic-voice-1.wav"]).slice(0, 4)).toBe("RIFF");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Speech", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const card = page.locator(".plugin-card").filter({ has: page.getByText("Speech, voice notes, and transcription", { exact: true }) });
  await card.locator("summary").first().click();
  await card.getByRole("button", { name: "Disable and remove code", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Speech", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(saved);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.audio)).toEqual(audio);
});

test("keyboard-only credential access masks secrets and requires a separately authenticated export", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Workspace views" });
  const credentials = rail.getByRole("button", { name: "Credential store", exact: true });
  await tabTo(page, credentials); await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Credential store", exact: true })).toBeVisible();
  const password = page.getByLabel("Master password", { exact: true });
  await tabTo(page, password); await page.keyboard.type("synthetic master password");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table", { name: "Unlocked credential entries" })).toBeVisible();
  await expect(page.getByText("invented-secret-canary", { exact: true })).toHaveCount(0);
  const show = page.getByRole("button", { name: "Show secret for Synthetic service", exact: true });
  await tabTo(page, show); await page.keyboard.press("Enter");
  await expect(page.getByText("invented-secret-canary", { exact: true })).toBeVisible();
  const exportButton = page.getByRole("button", { name: "Plaintext export", exact: true });
  await tabTo(page, exportButton); await page.keyboard.press("Enter");
  const authenticate = page.getByLabel("Current master password", { exact: true });
  await expect(authenticate).toHaveValue("");
  await tabTo(page, authenticate); await page.keyboard.type("synthetic master password");
  const confirm = page.getByRole("checkbox", { name: /exposes every credential in plaintext/ });
  await tabTo(page, confirm); await page.keyboard.press("Space");
  const finish = page.getByRole("button", { name: "Export plaintext", exact: true });
  await tabTo(page, finish); await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.credentialActions)).toContain("export");
  await expect(page.getByRole("button", { name: "New entry", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Credential store", exact: true })).toHaveCount(0);
  await expect(page.getByText("invented-secret-canary", { exact: true })).toHaveCount(0);
});

test("Control-Space dictates from a Rich note without placing a caret or switching to Source", async ({ page }) => {
  await command(page, "Authoring.md");
  await expect(page.getByRole("navigation", { name: "Workspace views" }).getByRole("button", { name: "Speech", exact: true })).toBeVisible();
  await expect(page.locator(".denote-text-style")).toBeVisible();
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]);
  await page.getByRole("tab", { name: "Authoring.md", exact: true }).focus();
  await page.keyboard.press("Control+Space");
  const speech = page.getByRole("region", { name: "Speech", exact: true });
  await expect(speech).toBeVisible();
  await expect(speech.getByText("Recording microphone audio", { exact: true })).toBeVisible();
  await expect(speech.getByRole("timer")).toHaveText(/0:0[1-9]/);
  await page.keyboard.press("Control+Space");
  const review = speech.getByRole("textbox", { name: "Review transcript", exact: true });
  await expect(review).toHaveValue("An invented local transcript.");
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"])).toBe(original);
  await review.fill("Reviewed synthetic dictation.");
  const insert = speech.getByRole("button", { name: "Insert transcript", exact: true });
  await tabTo(page, insert); await page.keyboard.press("Enter");
  await expect(speech).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]))
    .toBe(`${original}\nReviewed synthetic dictation.`);
  await expect(page.getByRole("radio", { name: "Rich text", exact: true })).toBeChecked();
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.activeMicrophoneTracks)).toBe(0);
});

test("Control-Space in the note's auxiliary Source search field never starts a microphone", async ({ page }) => {
  await sourceCaret(page);
  await page.keyboard.press("F3");
  const search = page.locator(".cm-search input[name='search']");
  await expect(search).toBeVisible();
  await search.focus();
  await page.keyboard.press("Control+Space");
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.microphoneRequests)).toBe(0);
  await expect(page.getByRole("region", { name: "Speech", exact: true })).toHaveCount(0);
});

test("Rich dictation replaces only the exact captured selection and sidebar switching releases microphone tracks", async ({ page }) => {
  await command(page, "Authoring.md");
  await expect(page.getByRole("navigation", { name: "Workspace views" }).getByRole("button", { name: "Speech", exact: true })).toBeVisible();
  await expect(page.locator(".denote-text-style")).toBeVisible();
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]);
  await page.getByText("A short phrase for review.", { exact: true }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Home");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+ArrowRight" : "Shift+End");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("A short phrase for review.");
  await page.keyboard.press("Control+Space");
  const speech = page.getByRole("region", { name: "Speech", exact: true });
  await expect(speech.getByText("Recording microphone audio", { exact: true })).toBeVisible();
  await expect(speech.getByRole("timer")).toHaveText(/0:0[1-9]/);
  await page.keyboard.press("Control+Space");
  await expect(speech.getByRole("textbox", { name: "Review transcript", exact: true })).toHaveValue("An invented local transcript.");
  await speech.getByRole("button", { name: "Insert transcript", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Authoring.md"]))
    .toBe(original.replace("A short phrase for review.", "An invented local transcript."));

  const rail = page.getByRole("navigation", { name: "Workspace views" });
  await rail.getByRole("button", { name: "Speech", exact: true }).click();
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.activeMicrophoneTracks)).toBe(0);
  await speech.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(speech.getByText("Recording microphone audio", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.activeMicrophoneTracks)).toBe(1);
  await rail.getByRole("button", { name: "Credential store", exact: true }).click();
  await expect(speech).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.activeMicrophoneTracks)).toBe(0);
  expect(await page.evaluate(() => window.__DENOTE_AUTHORING__.microphoneRequests)).toBe(2);
  expect(await page.evaluate(() => Object.keys(window.__DENOTE_AUTHORING__.audio))).toEqual([]);
});

test("credential sidebar adds, copies, links, and removes services without persisting service domains", async ({ page }) => {
  await command(page, "Credential store");
  const panel = page.getByRole("region", { name: "Credential store", exact: true });
  await panel.getByLabel("Master password", { exact: true }).fill("synthetic master password");
  await panel.getByRole("button", { name: "Unlock credential store", exact: true }).click();
  const link = panel.getByRole("link", { name: "Open Synthetic service", exact: true });
  await tabTo(page, link); await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Open service link?", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Allow all external domains", exact: true })).toHaveCount(0);
  await confirmation.getByRole("button", { name: "Open link", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.externalLinks)).toEqual(["https://synthetic.invalid/"]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("synthetic.invalid");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(panel.getByRole("table", { name: "Unlocked credential entries" })).toHaveCount(0);
  await panel.getByLabel("Master password", { exact: true }).fill("synthetic master password");
  await panel.getByRole("button", { name: "Unlock credential store", exact: true }).click();
  const copy = panel.getByRole("button", { name: "Copy service for Synthetic service", exact: true });
  await tabTo(page, copy); await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.credentialActions)).toContain("copy-service");
  await panel.getByRole("button", { name: "New entry", exact: true }).click();
  await panel.getByLabel("Service", { exact: true }).fill("Invented account");
  await panel.getByLabel("Username", { exact: true }).fill("invented-user");
  await panel.getByLabel("Password or token", { exact: true }).fill("invented-new-secret");
  await panel.getByLabel("URL", { exact: true }).fill("https://example.invalid/account");
  await panel.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(panel.getByRole("rowheader", { name: /Invented account/ })).toBeVisible();
  await expect(panel.getByText("invented-new-secret", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Delete Invented account", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(panel.getByRole("rowheader", { name: /Invented account/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "New entry", exact: true })).toBeFocused();
  await page.getByRole("navigation", { name: "Workspace views" }).getByRole("button", { name: "Speech", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("Synthetic service", { exact: true })).toHaveCount(0);
});

test("dictation never reuses a saved table-cell selection after returning to the main Rich editor", async ({ page }) => {
  await command(page, "Deck.md");
  await expect(page.getByRole("navigation", { name: "Workspace views" }).getByRole("button", { name: "Speech", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Rich text", exact: true })).toBeChecked();
  const original = await page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"]);
  await page.getByText("Example", { exact: true }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Home");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+ArrowRight" : "Shift+End");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Example");
  await page.getByRole("heading", { name: "First slide", exact: true }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowLeft" : "Home");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+ArrowRight" : "Shift+End");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("First slide");
  await page.keyboard.press("Control+Space");
  const speech = page.getByRole("region", { name: "Speech", exact: true });
  await expect(speech.getByText("Recording microphone audio", { exact: true })).toBeVisible();
  await expect(speech.getByRole("timer")).toHaveText(/0:0[1-9]/);
  await page.keyboard.press("Control+Space");
  await expect(speech.getByRole("textbox", { name: "Review transcript", exact: true })).toHaveValue("An invented local transcript.");
  await speech.getByRole("button", { name: "Insert transcript", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__DENOTE_AUTHORING__.documents["Deck.md"]))
    .toBe(original.replace("# First slide", "# An invented local transcript."));
});
