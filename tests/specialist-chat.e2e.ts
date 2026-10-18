// Not yet run under e2e: needs `e2e` and `@e2e-dev/web` installed (see docs/development.md).
// Runs against apps/web/src/e2e-stack.ts, whose synthetic provider streams `partial`, then holds
// the turn open until POST /release, so the test observes streaming without timing guesses.
import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

const control = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? "3407"}`;
const answer = {
  partial: "The pump-test report is the open blocker.",
  rest: "Ask the seller for the signed report before replying to the buyer.",
};

test.setup(
  "a specialist signs in",
  { sessions: ["specialist"] },
  async ({ app, screen, session, browser }) => {
    const specialist = credentials.user("specialist");
    await app.open("/sign-in");
    await screen.getByLabel("Email").fill(specialist.username);
    await screen.getByLabel("Password").fill(specialist.password);
    await screen.getByRole("button", "Sign in").tap();
    await expect(browser).toHaveURL("/desk");
    await expect(screen.getByRole("heading", "Municipal sales.")).toBeVisible();
    await session.save("specialist");
  },
);

test(
  "a streamed sale-assistant reply persists across reload",
  { session: "specialist" },
  async ({ app, screen, browser }) => {
    const message = `What blocks this sale? (e2e ${Date.now()})`;
    await app.open("/desk");
    await screen.getByRole("link", "Austin Fire Department", { exact: false }).tap();
    await expect(browser).toHaveURL("/desk/municipalities/austin-fire-department");

    await screen.getByRole("button", "Sale assistant").tap();
    const chat = screen.getByRole("dialog", "Sale assistant");
    await chat.getByLabel("Message sale assistant").fill(message);
    await chat.getByRole("button", "Send to sale assistant").tap();

    await expect(chat.getByText(message)).toBeVisible();
    await expect(chat.getByText(answer.partial, { exact: false })).toBeVisible();
    await expect(chat.getByText("Writing a draft…")).toBeVisible();
    await expect(chat.getByText(answer.rest, { exact: false })).toBeHidden();

    const released = await fetch(`${control}/release`, { method: "POST" });
    expect(released.status).toBe(204);
    await expect(chat.getByText(answer.rest, { exact: false })).toBeVisible();
    await expect(chat.getByText("Draft · Human review required")).toBeVisible();

    await browser.reload();
    await screen.getByRole("button", "Sale assistant").tap();
    const reloaded = screen.getByRole("dialog", "Sale assistant");
    await expect(reloaded.getByText(message)).toBeVisible();
    await expect(reloaded.getByText(answer.rest, { exact: false })).toBeVisible();
    await expect(reloaded.getByText("Draft · Human review required")).toBeVisible();
  },
);
