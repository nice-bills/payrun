import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
const c = createPublicClient({ chain: baseSepolia, transport: http() });
const a = "0x878f6621a3bAF5d037bbA918d80d804c8b8FD56B";
const usdc = await c.readContract({ address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", abi: erc20Abi, functionName: "balanceOf", args: [a] });
console.log("ETH", formatUnits(await c.getBalance({ address: a }), 18), "USDC", formatUnits(usdc, 6));
