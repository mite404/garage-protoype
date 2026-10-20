import { expect, test, type Page } from "@playwright/test";

// Read-only phone-width checks for every desk surface a rep uses on the go. Runs before the
// funnel spec mutates the seeded walkthrough, so it sees the same synthetic records.
const phone = { width: 390, height: 844 };
const listPages = ["/desk", "/desk/sourcing", "/desk/prospects", "/desk/growth", "/desk/tokens"];
const accountTabs = ["overview", "fit", "outreach", "sources", "activity"];

test.use({ viewport: phone, hasTouch: true });

async function firstHref(page: Page, prefix: string) {
  await page.goto(prefix === "/desk/sourcing/" ? "/desk/sourcing" : "/desk/prospects");
  const href = await page.locator(`main a[href^='${prefix}']`).first().getAttribute("href");
  return href!.split("?")[0]!;
}

// Only review tables with selection checkboxes may scroll their columns sideways.
function sidewaysScrolling(page: Page) {
  return page.evaluate(() => {
    const scrolls = (el: Element) =>
      ["auto", "scroll"].includes(getComputedStyle(el).overflowX) &&
      el.scrollWidth > el.clientWidth + 2;
    const page = document.documentElement.scrollWidth > window.innerWidth ? ["page"] : [];
    const boxes = [...document.querySelectorAll("main *")]
      .filter((el) => scrolls(el) && !el.querySelector("input"))
      .map((el) => el.textContent!.trim().slice(0, 30));
    return [...page, ...boxes];
  });
}

// Block-level targets under 44px; inline links in running text are exempt, as in WCAG 2.5.8.
function smallTargets(page: Page) {
  return page.$$eval(
    "main :is(a, button, summary, select), header a, nav a, label:has(> input:is([type=checkbox], [type=radio]))",
    (targets) =>
      targets
        .filter((el) => getComputedStyle(el).display !== "inline" && !el.closest("[hidden]"))
        .map((el) => ({ el, height: el.getBoundingClientRect().height }))
        .filter(({ height }) => height > 0 && height < 44)
        .map(({ el, height }) => `${el.textContent!.trim().slice(0, 30)}: ${Math.round(height)}px`),
  );
}

test("desk pages fit a phone with 44px touch targets", async ({ page }) => {
  const connection = await firstHref(page, "/desk/sourcing/");
  const prospect = await firstHref(page, "/desk/prospects/");
  const urls = [...listPages, prospect, ...accountTabs.map((tab) => `${connection}?tab=${tab}`)];
  for (const url of urls) {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
    expect(await sidewaysScrolling(page), `${url} scrolls sideways`).toEqual([]);
    expect(await smallTargets(page), `${url} targets under 44px`).toEqual([]);
  }
});

test("account tabs fit without scrolling and the assistant clears the page end", async ({
  page,
}) => {
  await page.goto(await firstHref(page, "/desk/sourcing/"));
  const tabs = page.getByRole("navigation", { name: "Account sections" });
  for (const tab of await tabs.locator("a, button").all())
    await expect(tab).toBeInViewport({ ratio: 1 });
  const launcher = page.getByRole("button", { name: /Sale assistant/ });
  await expect(launcher).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const footer = (await page.locator(".desk-body > footer").boundingBox())!;
  const button = (await launcher.boundingBox())!;
  expect(footer.y + footer.height, "page end clears the assistant").toBeLessThanOrEqual(button.y);
});
