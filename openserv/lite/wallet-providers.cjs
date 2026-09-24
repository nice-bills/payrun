// Deploy bundle only: AgentKit's wallet-providers index loads every wallet (Privy, Solana, …); Payrun uses CDP EVM.
module.exports = {
  ...require("../../node_modules/@coinbase/agentkit/dist/wallet-providers/walletProvider.js"),
  ...require("../../node_modules/@coinbase/agentkit/dist/wallet-providers/evmWalletProvider.js"),
  ...require("../../node_modules/@coinbase/agentkit/dist/wallet-providers/cdpEvmWalletProvider.js"),
};
