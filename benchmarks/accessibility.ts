import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

export async function auditAccessibility(
  page: Page, info: TestInfo, name: string, selector?: string,
): Promise<void> {
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (selector) builder = builder.include(selector);
  const result = await builder.analyze();
  await info.attach(name, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.violations.map((violation) => ({
    id: violation.id, help: violation.help, targets: violation.nodes.map((node) => node.target),
  }))).toEqual([]);
}
