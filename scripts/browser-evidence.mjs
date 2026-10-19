import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Opens a named agent-browser session as a signed-in fine-pointer user of a disposable local app,
 * with helpers that capture evidence under `.amp/in/artifacts/<folder>/`.
 * @throws If agent-browser or its Chrome build is unavailable.
 */
export function openEvidenceSession({ session, folder, origin, cookie }) {
  const output = resolve(".amp/in/artifacts", folder);
  const scratch = mkdtempSync(join(tmpdir(), `${folder}-browser-`));
  const browsers = join(process.env.HOME, ".agent-browser/browsers");
  const chrome = join(
    browsers,
    readdirSync(browsers)
      .filter((name) => name.startsWith("chrome-"))
      .sort()
      .at(-1),
    "chrome",
  );
  const wrapper = join(scratch, "chrome.sh");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec '${chrome}' '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4' "$@"\n`,
    { mode: 0o700 },
  );
  mkdirSync(output, { recursive: true });
  const browser = (...args) =>
    execFileSync("agent-browser", ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 45000,
    });
  browser("--executable-path", wrapper, "open", origin);
  const separator = cookie.indexOf("=");
  browser(
    "cookies",
    "set",
    cookie.slice(0, separator),
    cookie.slice(separator + 1),
    "--url",
    origin,
    "--httpOnly",
    "--sameSite",
    "Lax",
  );
  browser("set", "viewport", "1280", "960", "2");
  return {
    browser,
    output,
    capture(name) {
      browser("eval", "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      browser("screenshot", join(output, `${name}.png`));
    },
    // Prints the page on failure, then always stops recording and closes only this session.
    finish(error) {
      if (error) {
        console.error(browser("get", "url"));
        console.error(browser("get", "text", "body"));
      }
      try {
        browser("record", "stop");
      } catch {
        /* Recording may already be closed. */
      }
      browser("close");
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
