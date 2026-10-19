import { expect, test, type Page } from "@playwright/test";

// One specialist session through the NY growth funnel, recorded as a single video:
// prospect review → reviewed sequence → qualification, then a buyer-need pairing from draft
// to reviewed reply and decision. Everything runs against synthetic records; nothing is sent.
const deskPages = [
  "/desk",
  "/desk/sourcing",
  "/desk/prospects",
  "/desk/growth",
  "/desk/tokens",
  "/account",
];
const isoTimestamp = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const readableDue = /Due [A-Z][a-z]{2} \d{1,2}, \d{4}/;

async function sameOriginLinks(page: Page) {
  return page.$$eval("a[href^='/']", (anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href")!.split("#")[0]!),
  );
}

async function reviewProspect(page: Page, quote: string) {
  const review = page.locator("#outreach-0");
  await review.getByLabel("Identity").selectOption({ label: "Confirmed by specialist" });
  await review.getByLabel("Account fit").selectOption({ label: "Fit" });
  await review
    .getByLabel("Original buying-signal text")
    .fill("Northfield board is reviewing replacement of its 2005 engine.");
  await review.getByLabel("Verbatim supporting quote").fill(quote);
  await review.getByLabel("Source / provenance").fill("Synthetic board minutes, October 2026");
  await review.getByLabel("Contact name").fill("Synthetic chief");
  await review.getByLabel("Recorded email").fill("northfield@example.test");
  await review
    .getByRole("combobox", { name: "Contact permission", exact: true })
    .selectOption({ label: "Allowlisted test recipient" });
  await review.getByLabel("Contact source and permission evidence").fill("Synthetic fixture.");
  await review.getByRole("button", { name: "Save human review" }).click();
}

test("specialist works the NY sourcing funnel end to end", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const visited = new Set<string>();

  await test.step("sign-in stories rotate on their own and jump from a dot", async () => {
    await page.goto("/sign-in");
    const dots = page.getByRole("button", { name: /Go to slide/ });
    await expect(dots).toHaveCount(4);
    await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(dots.nth(1)).toHaveAttribute("aria-current", "true", { timeout: 7_000 });
    await dots.nth(3).click();
    await expect(page.getByText("Elba-Salem Fire Protection District, Illinois")).toBeVisible();
  });

  await test.step("work queue lists pairings, prospects and active deals", async () => {
    await page.goto("/desk");
    await expect(page.getByRole("heading", { name: "Work queue", level: 1 })).toBeVisible();
    for (const account of [
      "Cedar Valley Fire District",
      "Maple Grove Fire Department",
      "Northfield Fire District",
    ])
      await expect(page.getByRole("link", { name: account })).toBeVisible();
    const deals = page.locator("section", {
      has: page.getByRole("heading", { name: "Active deals" }),
    });
    await expect(deals.getByRole("link", { name: "Austin Fire Department" })).toBeVisible();
    await expect(page.getByText("closedLost")).toHaveCount(0);
  });

  await test.step("prospect review explains a quote that is not verbatim", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByText("Accounts").click();
    await page.getByRole("link", { name: "Northfield Fire District" }).click();
    await expect(page.locator(".desk-role")).toHaveText("Prospect");
    await page.getByRole("link", { name: "Confirm identity" }).click();
    await expect(page.locator("#outreach-0")).toHaveAttribute("open", "");
    await reviewProspect(page, "replacing the engine next year");
    await expect(
      page.getByText("Copy the supporting quote word for word from the original"),
    ).toBeVisible();
    await reviewProspect(page, "reviewing replacement of its 2005 engine");
    const steps = page.getByRole("navigation", { name: "Outreach progress" });
    await expect(steps.getByRole("link", { name: /Draft review/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(steps.getByRole("link", { name: /Contact review/ })).toContainText("✓");
  });

  await test.step("reviewed sequence queues with delivery disabled", async () => {
    const draft = page.locator("#outreach-1");
    await draft.getByLabel("Subject").fill("Is your 2005 engine being offered for sale?");
    await draft
      .getByLabel("Reviewed message")
      .fill("Could you confirm sale status and who can authorize it? Reply STOP to opt out.");
    await draft.getByRole("button", { name: "Approve and queue sequence" }).click();
    const delivery = page.locator("#outreach-2");
    await expect(delivery).toHaveAttribute("open", "");
    await expect(delivery.getByText("External delivery disabled")).toBeVisible();
    await expect(delivery.getByText(readableDue).first()).toBeVisible();
    await expect(delivery).not.toContainText(isoTimestamp);
  });

  await test.step("stepper opens the reply step and qualification opens the account", async () => {
    await page
      .getByRole("navigation", { name: "Outreach progress" })
      .getByRole("link", { name: /Reply/ })
      .click();
    const reply = page.locator("#outreach-3");
    await expect(reply).toHaveAttribute("open", "");
    await reply.getByLabel("Published vehicle ID").fill("demo-pumper");
    await reply
      .getByLabel("Original qualified reply")
      .fill("Yes, the 2005 engine is for sale once the board approves. I can authorize it.");
    await reply.getByLabel("Reply provenance").fill("Synthetic fixture reply");
    await reply.getByRole("button", { name: "Create reviewed opportunity" }).click();
    await expect(page.locator(".desk-role")).toHaveText("Qualified buyer");
    await reply.getByRole("link", { name: /Open account workspace/ }).click();
    await expect(
      page.getByRole("heading", { name: "Northfield Fire District", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/desk\/municipalities\/growth-/);
  });

  await test.step("pairing draft is saved and stays readable", async () => {
    await page.goto("/desk/sourcing");
    await page.getByRole("link", { name: "Cedar Valley Fire District for Pine Brook FD" }).click();
    await expect(page.getByRole("cell", { name: /Unknown/ })).toHaveCount(4);
    await page.getByRole("navigation", { name: "Account sections" }).getByText("Outreach").click();
    await page.getByRole("button", { name: "Save reviewed draft" }).click();
    const steps = page.getByRole("navigation", { name: "Outreach progress" });
    await expect(steps.getByRole("button", { name: /Delivery/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await steps.getByRole("button", { name: /Draft review/ }).click();
    await expect(page.getByRole("heading", { name: "Is your pumper for sale?" })).toBeVisible();
  });

  await test.step("recorded reply becomes a reviewed fact and a decision", async () => {
    await page
      .getByLabel("Record a reply received by phone or in person")
      .fill(
        "Yes, our pumper is for sale from November. It is 118 inches tall. We are asking " +
          "150000 dollars; transport is extra. Chief Ruiz can authorize the sale.",
      );
    await page.getByRole("button", { name: "Record reply" }).click();
    await expect(page.getByText("Proposed updates · Not yet approved")).toBeVisible();
    await page.getByRole("checkbox", { name: "Height: 118 in" }).check();
    await page.getByRole("button", { name: "Save selected reviewed answers" }).click();
    await page
      .getByRole("navigation", { name: "Account sections" })
      .getByText("Vehicles & fit")
      .click();
    await expect(page.getByRole("row", { name: /Height ≤120 in/ })).toContainText("Met");
    await page.getByLabel("Reason").fill("Height met; sale status, price and authority open.");
    await page.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText(/Recorded .* against need revision/)).toBeVisible();
    await page.getByRole("navigation", { name: "Account sections" }).getByText("Activity").click();
    await expect(page.getByText("Height accepted")).toBeVisible();
    await expect(page.getByText("Decision recorded: investigate")).toBeVisible();
  });

  await test.step("docked assistant streams a labelled synthetic answer", async () => {
    await page.getByLabel("Message account assistant").fill("What is still blocking this pairing?");
    await page.getByRole("button", { name: "Send to account assistant" }).click();
    const dock = page.getByRole("complementary", { name: "Account assistant" });
    await expect(dock.getByText(/Synthetic local model/)).toBeVisible();
    await expect(dock.getByRole("heading", { name: "Information request" })).toBeVisible();
  });

  await test.step("reply review keeps answers unresolved and drafts a clarification", async () => {
    await page.goto("/desk/sourcing");
    await page.getByRole("link", { name: "Maple Grove Fire Department for Pine Brook FD" }).click();
    await page.getByRole("navigation", { name: "Account sections" }).getByText("Outreach").click();
    await page.getByRole("button", { name: "Keep unresolved" }).click();
    await expect(page.getByText("Kept unresolved. No reviewed facts changed.")).toBeVisible();
    await page.getByRole("button", { name: "Draft clarification" }).click();
    await expect(page.getByLabel("Message account assistant")).toHaveValue(
      /Draft a clarification for Maple Grove Fire Department/,
    );
    await page.getByRole("link", { name: "Open buyer need" }).click();
    await expect(page).toHaveURL(/\/desk\/sourcing#need-/);
  });

  await test.step("outcomes use readable labels and dates", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByText("Outcomes").click();
    await expect(page.getByText("closed lost").first()).toBeVisible();
    await expect(page.getByText(/earliest due [A-Z][a-z]{2} \d{1,2}, \d{4}/).first()).toBeVisible();
  });

  await test.step("active deals open their evidence review", async () => {
    await page.goto("/desk");
    await page.getByRole("link", { name: "Austin Fire Department" }).click();
    await expect(page.getByRole("heading", { name: "Austin Fire Department" })).toBeVisible();
    await page.getByRole("link", { name: /Review evidence/ }).click();
    await expect(page.getByRole("heading", { name: "2004 synthetic pumper" })).toBeVisible();
  });

  await test.step("every internal desk link resolves", async () => {
    for (const path of deskPages) {
      await page.goto(path);
      for (const href of await sameOriginLinks(page)) visited.add(href);
    }
    const broken: string[] = [];
    for (const href of visited) {
      const response = await request.get(href, { maxRedirects: 0 });
      if (response.status() >= 400) broken.push(`${response.status()} ${href}`);
    }
    expect(broken).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
