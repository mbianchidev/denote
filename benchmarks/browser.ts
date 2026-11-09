import { expect, type Locator, type Page } from "@playwright/test";

export async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
}

export async function placeRichCaretAtEnd(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    await target.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
    await painted(page);
    expect(await target.evaluate((element) => {
      const owner = element.closest('[contenteditable="true"]');
      const selection = window.getSelection();
      if (document.activeElement !== owner || !selection?.isCollapsed ||
          !selection.anchorNode || !element.contains(selection.anchorNode)) return false;
      const prefix = document.createRange();
      prefix.selectNodeContents(element);
      prefix.setEnd(selection.anchorNode, selection.anchorOffset);
      return prefix.toString() === element.textContent;
    })).toBe(true);
  }).toPass({ timeout: 5000 });
}
