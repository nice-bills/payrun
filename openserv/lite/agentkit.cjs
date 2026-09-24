// Deploy bundle only: stands in for "@coinbase/agentkit" with the pieces Payrun uses.
module.exports = {
  ...require("../../node_modules/@coinbase/agentkit/dist/agentkit.js"),
  ...require("./wallet-providers.cjs"),
  ...require("./action-providers.cjs"),
};
