import assert from "node:assert/strict";
import { test } from "node:test";
import { PEEK_CLOSE_MS, PEEK_OPEN_MS, peekIntent } from "./sidebar-peek";

function host() {
  const page = { open: false, held: false, hides: [] as boolean[] };
  const peek = peekIntent({
    open: () => page.open,
    held: () => page.held,
    show: () => {
      page.open = true;
    },
    hide: (instant) => {
      page.hides.push(instant);
      page.open = false;
    },
  });
  return { page, peek };
}

test("the peek waits for the pointer to leave, rests before opening, and lingers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page, peek } = host();

  peek.point(true); // still on the trigger that just collapsed it
  t.mock.timers.tick(PEEK_OPEN_MS);
  assert.equal(page.open, false);

  peek.point(false);
  peek.point(true);
  t.mock.timers.tick(PEEK_OPEN_MS - 1);
  assert.equal(page.open, false, "passing over never opens it");
  t.mock.timers.tick(1);
  assert.equal(page.open, true);

  peek.point(false);
  t.mock.timers.tick(PEEK_CLOSE_MS - 1);
  peek.point(true); // back in time keeps it out
  t.mock.timers.tick(PEEK_CLOSE_MS);
  assert.equal(page.open, true);

  page.held = true; // keyboard focus in the column holds it
  peek.point(false);
  t.mock.timers.tick(PEEK_CLOSE_MS);
  assert.equal(page.open, true);
  page.held = false;
  peek.release();
  t.mock.timers.tick(PEEK_CLOSE_MS);
  assert.deepEqual(page.hides, [false]);
});

test("Escape closes at once and the pointer must leave before it peeks again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page, peek } = host();
  peek.point(false);
  peek.point(true);
  t.mock.timers.tick(PEEK_OPEN_MS);

  peek.close(true);
  assert.deepEqual(page.hides, [true]);
  peek.point(true);
  t.mock.timers.tick(PEEK_OPEN_MS);
  assert.equal(page.open, false, "the pointer still on it does not reopen it");
  peek.point(false);
  peek.point(true);
  t.mock.timers.tick(PEEK_OPEN_MS);
  assert.equal(page.open, true);
});
