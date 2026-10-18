import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { gateway } from "ai";

const port = process.env.E2E_PORT ?? "3406";
const controlPort = process.env.E2E_CONTROL_PORT ?? "3407";
// Synthetic only: the controlled identity provider accepts exactly this account and password.
const specialist = {
  username: "specialist@example.test",
  password: process.env.E2E_SPECIALIST_PASSWORD ?? "synthetic-e2e-password",
};

export default {
  // Model choice is pending the user's decision; see docs/development.md. The gateway line is init's
  // placeholder and no test calls an agent step until a provider is chosen.
  agents: {
    default: {
      model: gateway("openai/gpt-6-luna-fast"),
      system: "You are a thorough QA agent. Verify every outcome.",
      context:
        "Signal Desk is a prototype where Garage specialists resolve blockers to a vehicle sale. " +
        "All data is synthetic. Nothing is sent externally.",
    },
  },
  credentials: { specialist },
  targets: [
    {
      engine: web(),
      app: {
        url: `http://127.0.0.1:${port}`,
        readyUrl: `http://127.0.0.1:${port}/sign-in`,
        command: {
          executable: "node",
          args: ["--conditions=react-server", "--import", "tsx", "apps/web/src/e2e-stack.ts"],
          env: {
            PORT: port,
            E2E_CONTROL_PORT: controlPort,
            E2E_DATABASE_URL:
              process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/sd_e2e_test",
            E2E_SPECIALIST_EMAIL: specialist.username,
            E2E_SPECIALIST_PASSWORD: specialist.password,
            TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
          },
          startupTimeout: 180_000,
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
