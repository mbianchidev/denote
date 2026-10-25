import { expect, test } from "@playwright/test";
import { build } from "vite";

async function fixture(entry: string): Promise<string> {
  const bundle = await build({
    configFile: false, logLevel: "error",
    build: { write: false, lib: { entry, name: "syntheticIndexFixture", formats: ["iife"] } },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!("output" in output)) throw new Error("Missing index benchmark output.");
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing index benchmark entry.");
  return chunk.code;
}

let native = "";
let projections = "";
test.beforeAll(async () => {
  native = await fixture("benchmarks/nativeFixture.ts");
  projections = await fixture("benchmarks/indexProjectionFixture.ts");
});

test("twenty thousand notes index off-thread while edits remain responsive and update only the changed file", async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  let searchWorkers = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => { if (worker.url().includes("search.worker")) searchWorkers += 1; });
  await page.addInitScript({ content: `window.__DENOTE_LARGE_INDEX__ = true;\n${native}` });
  await page.goto("/");
  await page.getByRole("button", { name: "Small.md", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "editable markdown", exact: true });
  await expect(editor).toContainText("Ready.");
  await expect.poll(() => searchWorkers).toBe(1);
  const initialReads = await page.evaluate(() => window.__DENOTE_BENCHMARK__.indexReads.length);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("Ready.", { exact: true }).click();
  await page.getByText("Ready.", { exact: true }).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    if (!selection) throw new Error("Missing synthetic index selection");
    selection.removeAllRanges();
    selection.addRange(range);
    window.__DENOTE_BENCHMARK__.inputLatencies = [];
  });
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.type("x");
    await expect.poll(() => page.evaluate(() => window.__DENOTE_BENCHMARK__.inputLatencies.length)).toBe(index + 1);
  }
  const samples = await page.evaluate(() => window.__DENOTE_BENCHMARK__.inputLatencies);
  const sorted = [...samples].sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const maximum = Math.max(...samples);
  expect(p95).toBeLessThan(250);
  expect(maximum).toBeLessThan(500);
  await expect.poll(() => page.evaluate(() => window.__DENOTE_BENCHMARK__.indexReads.length), { timeout: 20_000 })
    .toBeGreaterThan(initialReads);
  await expect.poll(() => page.evaluate(() => window.__DENOTE_BENCHMARK__.documents["Small.md"]))
    .toContain(`Ready.${"x".repeat(20)}`);
  const updates = await page.evaluate((start) => window.__DENOTE_BENCHMARK__.indexReads.slice(start), initialReads);
  expect(updates.flat()).toEqual(["Small.md"]);
  await page.getByRole("textbox", { name: "Search text", exact: true }).fill("x".repeat(20));
  await expect(page.locator(".search-result").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => window.__DENOTE_BENCHMARK__.unexpectedCommands)).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  console.log(JSON.stringify({ benchmark: "large-vault-indexing", documents: 20_004, p95, maximum, updatedPaths: updates.flat() }));
  await info.attach("large-vault-indexing", {
    body: JSON.stringify({ documents: 20_004, p95, maximum, samples, updates }), contentType: "application/json",
  });
});

test("large-vault graph, task and calendar snapshots reuse every unchanged note", async ({ page }, info) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: projections });
  const result = await page.evaluate(() => window.__DENOTE_INDEX_PROJECTIONS__());
  expect(result.documents).toBe(20_000);
  expect(result.graphChanges).toBe(1);
  expect(result.taskChanges).toBe(1);
  expect(result.reusedGraph).toBe(result.graphCount - 1);
  expect(result.reusedTasks).toBe(result.taskCount - 1);
  expect(result.reusedCalendar).toBe(result.calendarCount - 1);
  expect(result.elapsed).toBeLessThan(200);
  console.log(JSON.stringify({ benchmark: "incremental-projections", ...result }));
  await info.attach("incremental-projections", { body: JSON.stringify(result), contentType: "application/json" });
});
