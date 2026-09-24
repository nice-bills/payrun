import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: { root: import.meta.dirname },
  // Wallet and PDF libraries run only on the server and must not be bundled.
  serverExternalPackages: ["@coinbase/agentkit", "@coinbase/cdp-sdk", "unpdf", "viem"],
};

export default config;
