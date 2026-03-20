# BTC 15-Minute Kalshi Bot

Railway deploys the `web/` app. The root `src/` tree is legacy and should not be treated as the production app surface.

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
- `BOT_REVERSAL_TARGET_CENTS`
- `BOT_REVERSAL_STOP_CENTS`
- `BOT_REVERSAL_MAX_ENTRY_PRICE_CENTS`
- `BOT_REVERSAL_FORCE_EXIT_LEAD_SECONDS`
- `BOT_REVERSAL_PRIMARY_DISTANCE_FLOOR`
- `BOT_REVERSAL_PRIMARY_ATR_MULTIPLIER`
- `BOT_REVERSAL_LATE_DISTANCE_FLOOR`
- `BOT_REVERSAL_LATE_ATR_MULTIPLIER`
- `BOT_SCALP_MAX_ENTRY_PRICE_CENTS`
- `BOT_TREND_MAX_ENTRY_PRICE_CENTS`
- `BOT_CONFIDENCE_THRESHOLD`
- `BOT_TIME_ZONE`
- `BOT_ENTRY_RETRY_ATTEMPTS`
- `BOT_ENTRY_REPRICE_CENTS`
- `BOT_ENTRY_RETRY_SIZE_DECAY`
- `BOT_ENTRY_MIN_UPSIDE_BUFFER_CENTS`
- `BOT_ENTRY_MIN_REWARD_RISK_RATIO`

## Trading flow

- `GET /api/trading/bot` returns the current market snapshot, indicators, decision, and same-day log.
- `POST /api/trading/bot` forces one immediate analysis cycle and, if eligible, submits the order.
- Background automation starts on server boot and keeps scanning new windows without the button.
- When the account is flat, automation scans once per minute by default. When live exposure exists, both scanning and managed-trade watching tighten to 10-second cadence.
- Reversal is the primary entry playbook in minutes `4-12`, with trend and scalp used as fallbacks when no reversal qualifies.

## Notes

- Kalshi execution requires both the key ID and the RSA private key for signing requests.
- Coinbase candles use public market data; no Coinbase key is required in the current implementation.
- The deployed app is the bot only. Legacy weather and games pages redirect back to `/`.
- The same-day activity log is kept in server memory for the current deployment instance.

## Build

```bash
npm run build
```
