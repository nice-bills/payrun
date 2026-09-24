import { config } from "dotenv"; config({ quiet: true, path: "/home/bills/.config/Claude/scratch-workspaces/eca05e3c-c2bf-40b5-be28-6bea94b7a59e/67692826-253c-4e66-8f7f-b57b8e9f85b2/scratch-2026-09-24-fc36ae/.env" });
import { CdpClient } from "@coinbase/cdp-sdk";
const cdp = new CdpClient({ apiKeyId: process.env.CDP_API_KEY_ID, apiKeySecret: process.env.CDP_API_KEY_SECRET, walletSecret: process.env.CDP_WALLET_SECRET });
for (let i = 0; i < 9; i++) {
  try { const r = await cdp.evm.requestFaucet({ address: process.env.PAYRUN_WALLET_ADDRESS!, network: "base-sepolia", token: "usdc" }); console.log("ok", r.transactionHash); }
  catch (e) { console.log("stop:", (e as Error).message.slice(0, 200)); break; }
}
