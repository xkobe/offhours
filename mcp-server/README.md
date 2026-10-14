# hoodscope-mcp-server

HoodScope MCP Server — pay-per-call Stock Token premium intelligence on Robinhood
Chain, exposed as Model Context Protocol tools for AI agents (Claude Desktop,
Cursor, OpenClaw, any MCP host). Settled in USDG on Robinhood Chain via **x402**
(EIP-3009): the payer signs off-chain (gasless), a facilitator broadcasts the
transfer. No API key, no subscription.

## Tools

| Tool | Input | Output | Price (USDG) |
|---|---|---|---|
| `premium_snapshot` | `symbols?[]`, `limit?` | Live premium/discount table: Chainlink reference vs Uniswap V3 DEX price, evidence + block | $0.01 |
| `stock_token_analysis` | `symbol` | Full analysis: prices, multiplier, premium history, evidence chain, verifiable SHA-256 report | $0.05 |
| `premium_history` | `symbol`, `days?` | Persisted snapshot series + premium events (start/peak/end) | $0.03 |
| `pons_graduation_stats` | `period?` | Pons V2 launchpad graduation trends (day/week/month), stock-quoted launch counts | $0.02 |
| `pons_graduation_watch` | `token` (0x address) | Live bonding-curve graduation progress vs on-chain threshold | $0.01 |
| `evidence_verify` | `reportHash` | Recompute CID fingerprint + check on-chain AnchorRegistry | $0.01 |

Every paid call returns an x402 receipt line: price, network, payer, payee,
nonce, settlement mode.

## Run

```bash
cd mcp-server
npm install
HOODSCOPE_API_URL=http://localhost:4663 node index.js
```

The server speaks MCP over stdio. `HOODSCOPE_API_URL` defaults to
`http://localhost:4663` (the HoodScope web server must be running; it owns the
SQLite history, reports, evidence and Pons endpoints).

## Modes

- **dev (default)**: signs real EIP-3009 payloads with a deterministic dev
  signer, no funds move. Receipts say `settlement dev_only`.
- **live**: set `X402_PAYEE` + `X402_SIGNER_PRIVATE_KEY` (+ `X402_FACILITATOR_URL`)
  to switch to the full verify/settle round-trip.

See `../docs/x402.md` for the protocol details and pricing table.

## Claude Desktop config

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hoodscope": {
      "command": "node",
      "args": ["C:/path/to/hoodscope/mcp-server/index.js"],
      "env": { "HOODSCOPE_API_URL": "http://localhost:4663" }
    }
  }
}
```

## Test

```bash
node scripts/test_mcp.js   # from the hoodscope root — drives the full stdio protocol
```

## Compliance

Data presentation only — not investment advice. Fixed pricing, fully
self-hosted, never touches user wallets or private keys. Aligns with the SEC's
April 2026 DeFi front-end guidance.
