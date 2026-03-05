"""
src/exchange/live_portfolio.py — Live trading portfolio for real Coinbase orders.

Mirrors PaperPortfolio's public interface exactly so morning_routine,
intraday_monitor, and eod_exit work with zero changes.

Key differences from PaperPortfolio:
  - execute_buy()  → places real market buy on Coinbase
  - execute_sell() → places real market sell on Coinbase
  - portfolio_value() → queries live USD balance from Coinbase
  - __init__()     → reloads open trades from DB on restart so stops/targets
                     survive container restarts mid-trade

Duplicate-order protection (two layers):
  1. has_open_position(symbol) — primary guard, blocks any second buy for a
     symbol that already has an open position in our DB / open_trades dict
  2. UUID4 client_order_id per order — Coinbase's 24h idempotency ensures
     that even if the same UUID is somehow reused, a second order is not created
"""

from datetime import datetime, timezone
from typing import Optional
from loguru import logger

import config
from src.exchange.client import ExchangeClient
from src.database.models import init_db, get_session_factory
from src.database.writer import save_trade, update_trade
from src.database.reader import get_open_trades


class LivePortfolio:
    """
    Live trading portfolio — identical interface to PaperPortfolio.

    State is persisted in Supabase (via SQLAlchemy). On startup, any open
    trades from before a restart are reloaded so the bot can continue
    monitoring their stops/targets.
    """

    def __init__(self, client: ExchangeClient):
        self._client = client
        self.open_trades: dict[str, dict] = {}   # symbol → trade info

        # DB (same as PaperPortfolio)
        self._engine = init_db()
        self._Session = get_session_factory(self._engine)

        # Reload any positions that were open before a restart
        self._sync_from_db()

        balance = self._get_usd_balance()
        logger.info(f"LivePortfolio initialized: ${balance:,.2f} USD available")
        if self.open_trades:
            logger.info(f"  Reloaded open positions: {list(self.open_trades.keys())}")
        else:
            logger.info("  No open positions to reload")

    # ─── Internal helpers ──────────────────────────────────────────────────────

    def _get_usd_balance(self) -> float:
        """Fetch live USD balance from Coinbase."""
        try:
            balances = self._client.fetch_balance()
            return float(balances.get("USD", {}).get("free", 0.0))
        except Exception as e:
            logger.error(f"Could not fetch USD balance from Coinbase: {e}")
            return 0.0

    def _sync_from_db(self):
        """
        On startup, reload open live trades from the DB.

        This means if the container restarts mid-trade, the bot picks up
        where it left off — stop/take-profit levels are recovered from the
        DB row written when the trade was opened.
        """
        trades = get_open_trades(paper=False)
        for trade in trades:
            self.open_trades[trade.symbol] = {
                "trade_id":          trade.id,
                "entry_price":       trade.entry_price,
                "quantity":          trade.quantity,
                "position_value":    trade.position_value,
                "stop_loss_price":   trade.stop_loss_price,
                "take_profit_price": trade.take_profit_price,
                "exchange_order_id": getattr(trade, "exchange_order_id", None),
                "entry_fee_usdt":    trade.entry_fee_usdt or 0.0,
                "opened_at":         trade.opened_at,
            }

    # ─── Portfolio state ───────────────────────────────────────────────────────

    def portfolio_value(self, current_prices: dict = None) -> float:
        """USD balance + open positions marked to current prices."""
        total = self._get_usd_balance()
        for symbol, trade in self.open_trades.items():
            price = (current_prices or {}).get(symbol, trade["entry_price"])
            total += trade["quantity"] * price
        return total

    def open_position_count(self) -> int:
        return len(self.open_trades)

    def is_at_max_positions(self) -> bool:
        return self.open_position_count() >= config.MAX_SIMULTANEOUS_TRADES

    def has_open_position(self, symbol: str) -> bool:
        return symbol in self.open_trades

    def get_total_exposure_pct(self, current_prices: dict = None) -> float:
        pv = self.portfolio_value(current_prices)
        if pv == 0:
            return 0.0
        usd = self._get_usd_balance()
        return (pv - usd) / pv

    # ─── Order execution ───────────────────────────────────────────────────────

    def execute_buy(
        self,
        symbol: str,
        entry_price: float,
        position_value: float,
        stop_loss_price: float,
        take_profit_price: float,
        atr: float,
        model_confidence: float = None,
        predicted_return: float = None,
    ) -> Optional[int]:
        """
        Place a real market buy on Coinbase and record it in the DB.

        PRIMARY DUPLICATE GUARD: has_open_position() blocks a second buy
        for any symbol already in open_trades. This is checked before any
        API call is made.

        Returns:
            trade_id (int) from DB, or None if rejected/failed.
        """
        # ── Guards (same as PaperPortfolio) ───────────────────────────────────
        if self.has_open_position(symbol):
            logger.warning(f"Buy rejected: already have open position in {symbol}")
            return None

        if self.is_at_max_positions():
            logger.warning(f"Buy rejected: at max positions ({config.MAX_SIMULTANEOUS_TRADES})")
            return None

        if self.get_total_exposure_pct() >= config.MAX_PORTFOLIO_EXPOSURE:
            logger.warning(f"Buy rejected: max portfolio exposure reached")
            return None

        usd_balance = self._get_usd_balance()
        if position_value > usd_balance:
            position_value = usd_balance
            logger.warning(f"Position size capped to available balance: ${position_value:.2f}")

        if position_value < 10:
            logger.warning(f"Buy rejected: position value ${position_value:.2f} too small")
            return None

        # ── Place real market buy ──────────────────────────────────────────────
        try:
            order = self._client.place_market_buy(symbol, position_value)
            exchange_order_id = order["id"]
        except Exception as e:
            logger.error(f"[LIVE] Market buy failed for {symbol}: {e}")
            return None

        # ── Fetch actual fill details (price + quantity) ───────────────────────
        fill_price = entry_price    # fallback
        quantity   = position_value / entry_price
        try:
            filled = self._client.fetch_order(exchange_order_id, symbol)
            if filled.get("price") and filled["price"] > 0:
                fill_price = filled["price"]
            if filled.get("filled") and filled["filled"] > 0:
                quantity = filled["filled"]
        except Exception as e:
            logger.warning(f"Could not fetch fill details for {exchange_order_id}: {e} — using estimates")

        fee = position_value * config.COINBASE_FEE_PCT

        trade_data = {
            "symbol":            symbol,
            "side":              "buy",
            "entry_price":       round(fill_price, 8),
            "exit_price":        None,
            "quantity":          round(quantity, 8),
            "position_value":    round(position_value, 2),
            "stop_loss_price":   round(stop_loss_price, 8),
            "take_profit_price": round(take_profit_price, 8),
            "atr_at_entry":      round(atr, 8),
            "model_confidence":  model_confidence,
            "predicted_return":  predicted_return,
            "pnl_usdt":          None,
            "pnl_pct":           None,
            "exit_reason":       None,
            "prediction_correct": None,
            "entry_fee_usdt":    round(fee, 4),
            "exit_fee_usdt":     None,
            "opened_at":         datetime.now(timezone.utc),
            "closed_at":         None,
            "paper":             False,
            "exchange_order_id": exchange_order_id,
        }

        trade_id = save_trade(trade_data)

        self.open_trades[symbol] = {
            "trade_id":          trade_id,
            "entry_price":       fill_price,
            "quantity":          quantity,
            "position_value":    position_value,
            "stop_loss_price":   stop_loss_price,
            "take_profit_price": take_profit_price,
            "exchange_order_id": exchange_order_id,
            "entry_fee_usdt":    fee,
            "opened_at":         trade_data["opened_at"],
        }

        logger.info(
            f"[LIVE BUY] {symbol}: qty={quantity:.6f} @ ${fill_price:,.2f} "
            f"| value=${position_value:.2f} | stop=${stop_loss_price:,.2f} "
            f"| target=${take_profit_price:,.2f}"
        )
        return trade_id

    def execute_sell(
        self,
        symbol: str,
        exit_price: float,
        exit_reason: str = "manual",
    ) -> Optional[dict]:
        """
        Place a real market sell on Coinbase and close the DB trade record.

        If the sell fails, the position is NOT removed from open_trades so
        the next monitor cycle will retry.
        """
        if symbol not in self.open_trades:
            logger.warning(f"Sell rejected: no open position in {symbol}")
            return None

        trade = self.open_trades[symbol]

        # ── Place real market sell ─────────────────────────────────────────────
        try:
            order = self._client.place_market_sell(symbol, trade["quantity"])
            exchange_sell_id = order["id"]
        except Exception as e:
            logger.error(f"[LIVE] Market sell FAILED for {symbol}: {e} — position kept open")
            return None

        # Remove from open trades only after successful order placement
        self.open_trades.pop(symbol)

        # ── Fetch actual fill price ────────────────────────────────────────────
        fill_price = exit_price
        try:
            filled = self._client.fetch_order(exchange_sell_id, symbol)
            if filled.get("price") and filled["price"] > 0:
                fill_price = filled["price"]
        except Exception as e:
            logger.warning(f"Could not fetch sell fill details: {e} — using current price estimate")

        gross_proceeds = trade["quantity"] * fill_price
        exit_fee  = gross_proceeds * config.COINBASE_FEE_PCT
        net_proceeds = gross_proceeds - exit_fee

        pnl_usdt = net_proceeds - trade["position_value"] - trade["entry_fee_usdt"]
        pnl_pct  = pnl_usdt / trade["position_value"]
        prediction_correct = pnl_usdt > 0 if exit_reason != "stop_loss" else False

        update_trade(trade["trade_id"], {
            "exit_price":        round(fill_price, 8),
            "pnl_usdt":          round(pnl_usdt, 4),
            "pnl_pct":           round(pnl_pct, 6),
            "exit_reason":       exit_reason,
            "prediction_correct": prediction_correct,
            "exit_fee_usdt":     round(exit_fee, 4),
            "closed_at":         datetime.now(timezone.utc),
        })

        pnl_color = "\033[92m" if pnl_usdt > 0 else "\033[91m"
        logger.info(
            f"[LIVE SELL] {symbol}: {exit_reason} @ ${fill_price:,.2f} "
            f"| P&L: {pnl_color}${pnl_usdt:+.2f} ({pnl_pct:+.2%})\033[0m"
        )
        return {
            "symbol":      symbol,
            "trade_id":    trade["trade_id"],
            "entry_price": trade["entry_price"],
            "exit_price":  fill_price,
            "quantity":    trade["quantity"],
            "pnl_usdt":    pnl_usdt,
            "pnl_pct":     pnl_pct,
            "exit_reason": exit_reason,
        }

    def check_stops(self, symbol: str, current_price: float) -> Optional[str]:
        """Check if stop-loss or take-profit has been hit. Returns reason or None."""
        if symbol not in self.open_trades:
            return None
        trade = self.open_trades[symbol]
        if current_price <= trade["stop_loss_price"]:
            return "stop_loss"
        if current_price >= trade["take_profit_price"]:
            return "take_profit"
        return None

    def close_all_positions(self, get_price_fn, reason: str = "eod_exit") -> list:
        """Close all open positions. Used for EOD forced exit."""
        symbols = list(self.open_trades.keys())
        results = []
        for symbol in symbols:
            try:
                price = get_price_fn(symbol)
                result = self.execute_sell(symbol, price, reason)
                if result:
                    results.append(result)
            except Exception as e:
                logger.error(f"Failed to close {symbol} during {reason}: {e}")
        return results

    def summary(self, current_prices: dict = None) -> dict:
        """Return summary dict for logging / dashboard."""
        pv = self.portfolio_value(current_prices)
        return {
            "usd_balance":    round(self._get_usd_balance(), 2),
            "portfolio_value": round(pv, 2),
            "open_positions": list(self.open_trades.keys()),
            "open_count":     len(self.open_trades),
        }
