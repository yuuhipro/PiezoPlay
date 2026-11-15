import { expect, test } from "@playwright/test";

test("dark by default, toggle and remember preference", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Dark mode" });
  await expect(toggle).toHaveAttribute("data-state", "checked");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await toggle.click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(toggle).toHaveAttribute("data-state", "unchecked");
  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const credit = page.locator(".maker-credit");
  await expect(credit).toHaveText("made by William Jr.");
  expect(await credit.evaluate(e => getComputedStyle(e).userSelect)).toBe("none");
});

