import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

if (existsSync("../../.env.local")) loadEnvFile("../../.env.local");

const nextConfig: NextConfig = {
  transpilePackages: ["@signal-desk/ui", "@signal-desk/catalog", "@signal-desk/contracts"],
  // pg loads pg-cloudflare only under the workerd export condition, which tracing cannot see.
  outputFileTracingIncludes: { "/*": ["../../node_modules/pg-cloudflare/**"] },
};

export default nextConfig;
