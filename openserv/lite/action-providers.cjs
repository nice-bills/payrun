// Deploy bundle only: AgentKit's action-providers index loads every integration; Payrun uses ERC-20 transfer and get_balance.
module.exports = {
  ...require("../../node_modules/@coinbase/agentkit/dist/action-providers/actionProvider.js"),
  ...require("../../node_modules/@coinbase/agentkit/dist/action-providers/actionDecorator.js"),
  ...require("../../node_modules/@coinbase/agentkit/dist/action-providers/erc20/index.js"),
};
