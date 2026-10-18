import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

if (existsSync("../../.env.local")) loadEnvFile("../../.env.local");

const nextConfig: NextConfig = {
  // The synthetic e2e stack opens 127.0.0.1; without this, `next dev` never hydrates there.
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@signal-desk/ui", "@signal-desk/catalog", "@signal-desk/contracts"],
};

export default nextConfig;
