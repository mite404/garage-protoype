import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const stateDir = new URL("../.e2e/", import.meta.url);

// The harness writes its session just after the app answers, so wait briefly for the file.
async function readSession(): Promise<{ origin: string; cookie: string }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = await readFile(new URL("session.json", stateDir), "utf8").catch(() => "");
    if (text) return JSON.parse(text);
    await setTimeout(100);
  }
  throw new Error("The e2e harness did not write its controlled session.");
}

/** Signs every test in as the harness's controlled synthetic specialist.
 * @throws If the harness never published its session.
 */
export default async function globalSetup() {
  const { origin, cookie } = await readSession();
  const [name, ...value] = cookie.split("=");
  const { hostname } = new URL(origin);
  const storage = {
    cookies: [
      {
        name: name!,
        value: value.join("="),
        domain: hostname,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  await writeFile(new URL("storage-state.json", stateDir), JSON.stringify(storage));
}
