import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "vite";
import { painted } from "./browser";

let fixture = "";
let pageErrors: string[] = [];

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      lib: {
        entry: "benchmarks/nativeFixture.ts",
        name: "syntheticNativeFixture",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(bundle) ? bundle : [bundle];
  if (bundles.length !== 1 || !("output" in bundles[0])) {
    throw new Error("Expected a single synthetic fixture bundle.");
  }
  const entry = bundles[0].output.find((output) => output.type === "chunk");
  if (!entry || entry.type !== "chunk") throw new Error("Missing synthetic fixture entrypoint.");
  fixture = entry.code;
});

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript({ content: fixture });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Small.md", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function openPage(page: Page, name: string, expectedText: string): Promise<number> {
  const button = page.getByRole("button", { name, exact: true });
  await button.evaluate((element, readyText) => {
    window.__DENOTE_BENCHMARK__.openingLatency = null;
    element.addEventListener("click", (event) => {
      const started = event.timeStamp;
      const observer = new MutationObserver(() => {
        const editor = document.querySelector<HTMLElement>(".denote-editor-content");
        if (!editor?.textContent?.includes(readyText)) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!editor.isConnected || editor.getClientRects().length === 0) {
            throw new Error("Synthetic page became hidden before its ready paint");
          }
          window.__DENOTE_BENCHMARK__.openingLatency = performance.now() - started;
        }));
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, { once: true, capture: true });
  }, expectedText);
  await button.click();
  await expect.poll(() => page.evaluate(() =>
    window.__DENOTE_BENCHMARK__.openingLatency,
  )).not.toBeNull();
  await expect(page.getByRole("textbox", { name: "editable markdown", exact: true }))
    .toContainText(expectedText);
  const elapsed = await page.evaluate(() => window.__DENOTE_BENCHMARK__.openingLatency);
  if (elapsed === null) throw new Error("Missing synthetic page-opening measurement");
  return elapsed;
}

async function typeSample(page: Page, editor: Locator, target?: Locator): Promise<number[]> {
  if (target) {
    await target.click();
    await target.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      if (!selection) throw new Error("Missing synthetic typing selection");
      selection.removeAllRanges();
      selection.addRange(range);
    });
  } else {
    await editor.focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  }
  await painted(page);
  await page.evaluate(() => { window.__DENOTE_BENCHMARK__.inputLatencies = []; });
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.type("x");
    await expect.poll(() => page.evaluate(() =>
      window.__DENOTE_BENCHMARK__.inputLatencies.length,
    )).toBe(index + 1);
  }
  return page.evaluate(() => window.__DENOTE_BENCHMARK__.inputLatencies);
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

for (const mode of ["rich", "markdown-source"] as const) {
  test(`${mode} typing reaches the next paint without long input stalls`, async ({ page }, info) => {
    const opening = await openPage(page, "Typing.md", "Typing target");
    if (mode === "markdown-source") {
      await page.getByRole("radio", { name: "Source mode", exact: true }).click();
    }
    const editor = mode === "rich"
      ? page.getByRole("textbox", { name: "editable markdown", exact: true })
      : page.locator(".markdown-editor-shell").getByRole("textbox");
    await expect(editor).toHaveCount(1);
    const latencies = await typeSample(
      page,
      editor,
      mode === "rich" ? page.getByText("Typing target", { exact: true }) : undefined,
    );
    const p95 = percentile95(latencies);
    const maximum = Math.max(...latencies);
    const budget = mode === "rich" ? 250 : 150;
    await info.attach(`${mode}-interaction-latencies`, {
      body: JSON.stringify({ opening, p95, maximum, budget, samples: latencies }),
      contentType: "application/json",
    });
    console.log(JSON.stringify({ benchmark: `${mode}-typing`, opening, p95, maximum, budget }));
    expect(p95, "95th-percentile key-to-paint latency").toBeLessThan(budget);
    expect(maximum, "worst key-to-paint latency").toBeLessThan(500);
    await expect.poll(() => page.evaluate(() =>
      window.__DENOTE_BENCHMARK__.documents["Typing.md"],
    )).toContain(`Typing target${"x".repeat(20)}`);
  });
}

test("large Markdown pages become visibly ready within the render budget", async ({ page }, info) => {
  const cold = await openPage(page, "Reading.md", "Synthetic section 499");
  await openPage(page, "Small.md", "Ready.");
  const warm = await openPage(page, "Reading.md", "Synthetic section 499");
  await info.attach("page-opening-latencies", {
    body: JSON.stringify({ cold, warm, coldBudget: 2500, warmBudget: 1500 }),
    contentType: "application/json",
  });
  console.log(JSON.stringify({
    benchmark: "page-opening", cold, warm, coldBudget: 2500, warmBudget: 1500,
  }));
  expect(cold, "cold large-page opening").toBeLessThan(2500);
  expect(warm, "warm large-page opening").toBeLessThan(1500);
});

test("plain source typing remains responsive in a large synthetic document", async ({ page }, info) => {
  await page.getByRole("button", { name: "Source.txt", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit Source.txt", exact: true });
  await expect(editor).toBeVisible();
  const latencies = await typeSample(page, editor);
  const p95 = percentile95(latencies);
  await info.attach("source-interaction-latencies", {
    body: JSON.stringify({ p95, samples: latencies }),
    contentType: "application/json",
  });
  console.log(JSON.stringify({ benchmark: "source-typing", p95 }));
  expect(p95, "source key-to-paint latency").toBeLessThan(150);
  expect(Math.max(...latencies)).toBeLessThan(500);
  await expect.poll(() => page.evaluate(() =>
    window.__DENOTE_BENCHMARK__.documents["Source.txt"],
  )).toContain("x".repeat(20));
});
