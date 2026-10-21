// The collapsed sidebar's peek, ported from YakLabs' projects panel (shell/peek.ts and
// peek-page.ts): with a fine pointer resting on the icon column's empty stretch,
// the column widens over the content at full width, and narrows again once the pointer has been
// away a moment. YakLabs slides an offcanvas panel out from behind its rail; here the icon
// column is the rail, so the peek only widens it, and open or closed is all its state.

/** How long the pointer rests on a place that peeks before the column widens. */
export const PEEK_OPEN_MS = 80;
/** How long the pointer may be away from the peek before the column narrows. */
export const PEEK_CLOSE_MS = 250;

// The trigger that takes focus back, and the column that widens.
const TRIGGER = '[data-sidebar="trigger"]';
const PANEL = '[data-slot="sidebar-container"]';
// At rest the icons name themselves in tooltips, so only the column's empty stretch peeks; once
// out, the whole column holds it. Unlike YakLabs, whose toggle sits in a title bar above the
// panel, the trigger is no place to peek: it sits beside the column, and the widened column
// would cover it under the pointer about to click it.
const QUIET = '[data-sidebar="menu-button"]';

/** What the peek's timing reads from the page, and where its steps go. */
export type PeekHost = {
  open: () => boolean;
  /** Keyboard focus in the column holds it out. */
  held: () => boolean;
  show: () => void;
  hide: (instant: boolean) => void;
};

/** What the page tells the peek's timing. */
export type PeekIntent = {
  /** The pointer moved; `inZone` says whether it is on a place that peeks. */
  point: (inZone: boolean) => void;
  /** Focus left the column, which may have held it out. */
  release: () => void;
  /** Closes the peek now, with no motion when a key asked. It waits for the pointer to leave. */
  close: (instant: boolean) => void;
  /** Stops the pending timer. */
  dispose: () => void;
};

/**
 * The peek's timing: widen after the pointer has rested on a place that peeks for
 * `PEEK_OPEN_MS`, so passing over the column never opens it; narrow once it has been away
 * `PEEK_CLOSE_MS`, unless `held`. A close, and the start of the timing (the sidebar just
 * collapsed under a pointer that clicked its rail), wait for the pointer to leave before it can
 * peek again.
 */
export function peekIntent({ open, held, show, hide }: PeekHost): PeekIntent {
  let hovered: boolean | null = null; // → unknown until the pointer first moves
  let suppressed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = (ms: number, run: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  const stop = () => clearTimeout(timer);
  const closeSoon = () =>
    start(PEEK_CLOSE_MS, () => {
      if (!held()) hide(false);
    });
  return {
    point(inZone) {
      if (inZone === hovered) return;
      hovered = inZone;
      stop();
      if (!inZone) {
        suppressed = false;
        if (open()) closeSoon();
      } else if (!suppressed && !open()) start(PEEK_OPEN_MS, show);
    },
    release() {
      if (hovered !== true && open() && !held()) closeSoon();
    },
    close(instant) {
      stop();
      suppressed = true;
      if (open()) hide(instant);
    },
    dispose: stop,
  };
}

function inPeekZone(target: EventTarget | null, out: boolean): boolean {
  if (!(target instanceof Element) || target.closest(PANEL) === null) return false;
  return out || target.closest(QUIET) === null;
}

// Escape closes the peek, unless a menu has it: the menu closes itself first. Heard in the
// capture phase, since an icon's tooltip, open on focus though hidden in a peek, swallows it.
function escapes(event: KeyboardEvent): boolean {
  const inMenu = event.target instanceof Element && event.target.closest('[role="menu"]') !== null;
  return event.key === "Escape" && !event.defaultPrevented && !inMenu;
}

/** Whether keyboard focus sits in the column, which holds the peek out. */
export function focusInPanel(): boolean {
  return document.querySelector(`${PANEL} :focus-visible`) !== null;
}

/**
 * Wires the page's pointer, keys and focus to the peek's timing. Escape closes it at once and
 * hands focus in the column to the trigger; following a link in it closes it.
 * @returns What removes every listener and stops the timing.
 */
export function listenForPeek(peek: PeekIntent, out: () => boolean): () => void {
  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "touch") peek.point(inPeekZone(event.target, out()));
  };
  const onLeave = () => peek.point(false);
  const onKey = (event: KeyboardEvent) => {
    if (!out() || !escapes(event)) return;
    if (document.activeElement?.closest(PANEL)) {
      document.querySelector<HTMLElement>(TRIGGER)?.focus();
    }
    peek.close(true);
  };
  const onClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(`${PANEL} a[href]`)) {
      peek.close(false);
    }
  };
  const onFocusOut = () => setTimeout(peek.release);
  document.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick);
  document.addEventListener("focusout", onFocusOut);
  return () => {
    peek.dispose();
    document.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick);
    document.removeEventListener("focusout", onFocusOut);
  };
}
