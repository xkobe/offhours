# HoodScope

**Off-hours premium intelligence for Robinhood Chain Stock Tokens.**

HoodScope is an open-source screening service for the 194 official Stock Tokens on
Robinhood Chain (chain ID `4663`). While US markets are closed, Chainlink reference
prices freeze at the last official close, but tokenized-stock DEX prices keep trading
24/7 — creating systematic, measurable premium/discount moves that re-close when
markets reopen. HoodScope tracks that gap in real time, with an evidence chain on
every data point and a pay-per-call MCP server settled in USDG via x402.

> Data presentation only — not investment advice.

---

## Features

| Area | What you get |
|---|---|
| **Premium Radar** | Every Stock Token sorted by live premium/discount: Chainlink reference vs Uniswap V3 DEX price, multiplier-adjusted, with pool evidence (address, fee tier, TVL). |
| **Watchlist** | Follow your symbols; off-hours anomaly flag when \|premium\| > 2% with the market closed, or > 10% anytime. |
| **Anomalies** | Detected premium excursions (start → peak → re-close) persisted from the snapshot history. |
| **Time Machine** | Dual price-line chart (reference + DEX) with premium axis and hover tooltips, plus MAX/PEAK/avg off-hours stats per symbol. |
| **Verify** | Every report carries a SHA-256 hash and CID fingerprint; `evidence_verify` checks the on-chain AnchorRegistry (when deployed). |
| **Pons Launchpad** | Graduation-rate trends (day/week/month), near-graduation watch (3.5–4.2 ETH zone), and post-graduation pool tracking — indexed straight from the Pons V2 factory. |
| **MCP Server** | 6 pay-per-call tools (x402, USDG, gasless for the payer) — no API key, no subscription. |
| **Telegram Alerts** | Hysteresis-ladder threshold alerts (1/2/3/5/10/20/50%) pushed to Telegram. |

## Why this asset class

- 194 official Stock Tokens issued via the Robinhood issuer beacon
  (`0xe10b6f6b…151b00`), EIP-1967 beacon-proxy validated.
- Stock Token = ERC-20 debt security with economic exposure to the underlying
  stock; trades 24/7 while the underlying market is open ~27% of the week.
- Reference price freezes at the official close; DEX price keeps moving →
  off-hours premium/discount regimes that revert at market open.
- Documented cases: weekend premium inflation with a crash at Monday's open;
  holiday-weekend tokens trading far above their reference price.

## Architecture

```
┌────────────────────────────────────────────────────┐
│                      Delivery                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  MCP Server  │  │ Telegram Bot │  │ Web Dashboard│
│  │  (x402 paid) │  │ (threshold)  │  │ (read-only) │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
└─────────┼─────────────────┼─────────────────┼───────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼───────┐
│                     Analytics                        │
│  ┌──────────────────────────────────────────────┐   │
│  │ SQLite store (snapshots, prices, events,     │   │
│  │ Pons launches/graduations, report anchors)   │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │ Verifiable report engine                     │   │
│  │ report → SHA-256 → CID → on-chain anchor     │   │
│  └──────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                     Data layer                      │
│  Robinhood Chain RPC (4663) │ hood-api │ hoodchain  │
│  Chainlink feeds │ Uniswap V3 │ Pons V2 factory     │
└─────────────────────────────────────────────────────┘
```

## Quick start

Requirements: **Node.js ≥ 20**.

```bash
git clone https://github.com/<you>/hoodscope.git
cd hoodscope
npm install

# 1) Run the web dashboard + APIs
npm run server            # → http://localhost:4663

# 2) (Optional) run one incremental index pass
npm run index

# 3) MCP server (stdio — attach in Claude Desktop / Cursor)
cd mcp-server && npm install && npm run mcp
```

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `RPC_URL` | Robinhood Chain RPC | `https://rpc.mainnet.chain.robinhood.com` |
| `PORT` | Web server port | `4663` |
| `ALERT_THRESHOLDS` | Telegram alert ladder, comma-separated | `1,2,3,5,10,20,50` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (alerts go **dry-run** without it) | — |
| `TELEGRAM_CHAT_ID` | Telegram chat to receive alerts | — |
| `X402_PAYEE` | Service payee for MCP paid tools | dev signer |
| `X402_SIGNER_PRIVATE_KEY` | Live x402 signing key (enables live mode) | dev mode |
| `X402_FACILITATOR_URL` | x402 facilitator for verify/settle | — |
| `ANCHOR_REGISTRY_ADDRESS` | Deployed AnchorRegistry for `evidence_verify` | — |
| `HOODSCOPE_DB` | SQLite database path | `data/hoodscope.db` |

## MCP tools & pricing (USDG on eip155:4663)

| Tool | Input | Output | Price |
|---|---|---|---|
| `premium_snapshot` | `symbols?`, `limit?` | Live premium/discount snapshot | $0.01 |
| `stock_token_analysis` | `symbol` | Full analysis + history + evidence + report hash | $0.05 |
| `premium_history` | `symbol`, `days?` | Historical premium series + events | $0.03 |
| `pons_graduation_stats` | `period?` | Pons graduation trends (day/week/month) | $0.02 |
| `pons_graduation_watch` | `token` (0x…) | Live graduation progress of one launchpad token | $0.01 |
| `evidence_verify` | `reportHash` | Verify report integrity / on-chain anchor | $0.01 |

Pay-per-call via **x402**: payer signs an EIP-3009 `TransferWithAuthorization`
off-chain (gasless), a facilitator broadcasts settlement in USDG. Receipts are
returned with every call. Without `X402_PAYEE` configured, tools run in **dev
mode** (real signature, no funds moved).

## Data methodology

- **Reference price**: on-chain Chainlink feed via `latestRoundData`
  (multiplier-adjusted, 8 decimals) when available; otherwise RHJ bid × multiplier.
- **DEX price**: Uniswap V3 pools on Robinhood Chain (factory `0x1f7d…2EfA`)
  paired against USDG/WETH, computed from `sqrtPriceX96`; USDG-quoted preferred,
  main pool by TVL. USDG ≈ $1.
- **Premium** = (DEX − reference) ÷ reference × 100%.
- **Anomaly** = \|premium\| > 2% during off-hours, or > 10% at any time.
- **Market hours**: NYSE hours, ET Mon–Fri 9:30–16:00; holidays approximated.
- **Coverage**: all 194 official Stock Tokens monitored; roughly half lack a
  USDG/WETH pool (paired only with meme tokens) and show reference price only.
- **Thin pools**: TVL under $50k → flagged `THIN`, premium readings less reliable.
- Every snapshot is persisted to SQLite; each evidence panel shows block +
  feed/round/pool provenance.

## Repository layout

```
hoodscope/
├── server.js              # web server + APIs + alert sweeps
├── lib/
│   ├── data.js            # snapshot builder (reference/DEX/premium)
│   ├── store.js           # SQLite persistence
│   ├── events.js          # premium events + beacon upgrade polling
│   ├── report.js          # verifiable report generation
│   ├── verify.js          # SHA-256 / CID fingerprint
│   ├── alerts.js          # hysteresis-ladder alert engine
│   ├── telegram.js        # Telegram pusher (dry-run until configured)
│   ├── pons_indexer.js    # Pons V2 factory event indexer
│   └── pons_stats.js      # graduation stats/watch APIs
├── scripts/
│   ├── index.js           # scheduled incremental indexer
│   ├── pons_backfill.js   # historical Pons backfill (resumable)
│   ├── compile_anchor.js  # compile AnchorRegistry
│   ├── deploy_anchor.js   # deploy anchor registry
│   └── test_mcp.js        # MCP stdio protocol tests
├── mcp-server/            # MCP server + x402 middleware
│   ├── index.js           # 6 tools
│   └── lib/x402.js        # pay-per-call middleware
├── public/                # dashboard (dark, desktop-first)
├── contracts/             # AnchorRegistry.sol
├── build/                 # compiled artifacts
├── data/                  # SQLite databases (git-ignored)
└── docs/
```

## License

MIT — see [LICENSE](./LICENSE).

## Compliance

HoodScope presents data only: no buy/sell recommendations, no investment advice.
MCP tools charge a fixed fee, are fully self-hosted, and never touch user wallets
or private keys. Aligns with the SEC's April 2026 DeFi front-end guidance.
