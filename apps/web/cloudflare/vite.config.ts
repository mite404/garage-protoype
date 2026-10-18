import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig, type Plugin } from "vite";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const transport = local("./src/transport.ts");

// `server-only` guards Next client bundles; a Worker has no client bundle to protect.
function serverOnly(): Plugin {
  return {
    name: "signal-desk-server-only",
    enforce: "pre",
    resolveId: (source) => (source === "server-only" ? "\0server-only" : null),
    load: (id) => (id === "\0server-only" ? "export {};" : null),
  };
}

// The guarantee suite's local provider and crash points. Never part of a deployable build.
function testSeams(): Plugin {
  return {
    name: "signal-desk-test-seams",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === transport ? local("./test/seams.ts") : null;
    },
  };
}

const testing = process.env.SIGNAL_DESK_TEST_SEAMS === "1";
// The suite crashes and restarts workerd, so object storage must persist, in a disposable place.
const testState = process.env.SIGNAL_DESK_TEST_STATE;

export default defineConfig({
  plugins: [
    serverOnly(),
    ...(testing ? [testSeams()] : []),
    flue(),
    cloudflare({
      config: flueWorkerConfig(),
      ...(testing && testState ? { persistState: { path: testState } } : {}),
    }),
  ],
});
