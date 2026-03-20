# BTC 15-Minute Kalshi Bot

This project is now a Bitcoin 15-minute Kalshi trading console built on the same Next.js 16 infrastructure. It:

- discovers the active BTC 15-minute Kalshi market
- pulls Coinbase public 1-minute BTC candles
- computes short-horizon indicators
- applies timing-risk rules with stricter handling for minutes `1-3` and `9-15`
- asks the AI for a structured `above`, `below`, or `no_trade` decision
- can submit a Kalshi order from the server when the signal clears the configured gates
- keeps a same-day server-side activity log for analyses and trade attempts

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS v4
- OpenAI Node SDK
- Railway-friendly deployment setup

## Local setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in:

- `OPENAI_API_KEY`
- `KALSHI_API_KEY_ID`
- `KALSHI_PRIVATE_KEY_PEM`

Optional runtime knobs:

- `KALSHI_ENABLE_AUTO_TRADE`
- `BOT_FIXED_STAKE_DOLLARS`
- `BOT_CONFIDENCE_THRESHOLD`
- `BOT_LATE_WINDOW_CONFIDENCE_THRESHOLD`
- `BOT_LATE_WINDOW_MIN_EDGE`
- `BOT_TIME_ZONE`
- `BOT_OPERATOR_EMAILS`

## Trading flow

- `GET /api/trading/bot` returns the current market snapshot, indicators, current decision, and same-day log.
- `POST /api/trading/bot` runs the analysis and, if enabled and qualified, submits the Kalshi order.
- The UI auto-refreshes the snapshot and exposes a manual `Analyze and trade` action.

## Notes

- Kalshi execution requires both the key ID and the RSA private key for signing requests.
- Coinbase candles use public market data; no Coinbase key is required in the current implementation.
- Live order execution is gated behind a Supabase-authenticated operator email allowlist from `BOT_OPERATOR_EMAILS`.
- The same-day activity log is kept in server memory for the current deployment instance.

## Build

```bash
npm run build
```
