import { resolve } from "node:path";
const here = resolve(import.meta.dirname);
/** esbuild plugin: route AgentKit's catch-all indexes to the slim stand-ins above. */
export const agentkitLite = {
  name: "agentkit-lite",
  setup(b) {
    b.onResolve({ filter: /^@coinbase\/agentkit$/ }, () => ({ path: resolve(here, "agentkit.cjs") }));
    b.onResolve({ filter: /^(\.\.?\/)+wallet-providers$/ }, (a) => (a.importer.includes("@coinbase/agentkit/dist") ? { path: resolve(here, "wallet-providers.cjs") } : undefined));
    b.onResolve({ filter: /^(\.\.?\/)+action-providers$/ }, (a) => (a.importer.includes("@coinbase/agentkit/dist") ? { path: resolve(here, "action-providers.cjs") } : undefined));
  },
};
