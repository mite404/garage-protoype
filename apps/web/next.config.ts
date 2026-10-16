import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

if (existsSync("../../.env.local")) loadEnvFile("../../.env.local");

const nextConfig: NextConfig = {
  transpilePackages: ["@signal-desk/ui", "@signal-desk/catalog", "@signal-desk/contracts"],
};

export default nextConfig;
