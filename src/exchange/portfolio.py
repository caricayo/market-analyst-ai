"""
src/exchange/portfolio.py — Paper trading portfolio with SQLite persistence.

Simulates Coinbase fees and slippage. Persists state across restarts via SQLite.
In live mode, reads actual balance from the exchange.
"""

from datetime import datetime, timezone
from typing import Optional
from loguru import logger

import config
from src.database.models import init_db, get_session_factory, Trade
from src.database.writer import save_trade, update_trade


class PaperPortfolio:
    """
    Paper trading engine. Maintains a simulated balance sheet.

    Balance persisted in SQLite via open trades and daily_stats.
    Starting balance loaded from config or set manually.
    """

    def __init__(self, starting_usdt: float = 10_000.0, simulation_run_id: str = None):
        """
        Args:
            starting_usdt:       Initial paper balance.
            simulation_run_id:   Set during walk-forward simulation to tag trades.
        """
        self.starting_usdt = starting_usdt
        self.usdt_balance  = starting_usdt
        self.simulation_run_id = simulation_run_id
        self.open_trades: dict[str, dict] = {}   # symbol → trade info

        # SQLite
        self._engine = init_db()
        self._Session = get_session_factory(self._engine)

        logger.info(f"PaperPortfolio initialized: ${starting_usdt:,.2f} USDT")

    # ─── Portfolio value ──────────────────────────────────────────────────────

    def portfolio_value(self, current_prices: dict[str, float] = None) -> float:
        """
        Total portfolio value = USDT balance + open positions at current prices.
        """
        total = self.usdt_balance
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
        """Returns fraction of portfolio currently in open positions."""
        pv = self.portfolio_value(current_prices)
        if pv == 0:
            return 0.0
        in_positions = pv - self.usdt_balance
        return in_positions / pv

    # ─── Order execution (paper) ──────────────────────────────────────────────

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
        Execute a simulated buy. Applies fee + slippage.

        Args:
            symbol:          e.g. "BTC/USDT"
            entry_price:     Current market price.
            position_value:  USDT amount to invest.
            stop_loss_price: Stop loss level.
            take_profit_price: Take profit level.
            atr:             ATR at entry (stored for reference).
            model_confidence: ML confidence score.
            predicted_return: ML predicted return.

        Returns:
            trade_id (int) or None if rejected.
        """
        if self.has_open_position(symbol):
            logger.warning(f"Buy rejected: already have open position in {symbol}")
            return None

        if self.is_at_max_positions():
            logger.warning(f"Buy rejected: at max positions ({config.MAX_SIMULTANEOUS_TRADES})")
            return None

        if self.get_total_exposure_pct() >= config.MAX_PORTFOLIO_EXPOSURE:
            logger.warning(f"Buy rejected: max portfolio exposure reached")
            return None

        if position_value > self.usdt_balance:
            position_value = self.usdt_balance
            logger.warning(f"Position size capped to available balance: ${position_value:.2f}")

        if position_value < 10:
            logger.warning(f"Buy rejected: position value ${position_value:.2f} too small")
            return None

        # Apply slippage to entry price (buy at slightly higher than market)
        fill_price = entry_price * (1 + config.SIMULATED_SLIPPAGE_PCT)
        fee = position_value * config.COINBASE_FEE_PCT
        usdt_spent = position_value + fee
        quantity = position_value / fill_price

        if usdt_spent > self.usdt_balance:
            logger.warning(f"Buy rejected: insufficient balance (need ${usdt_spent:.2f}, have ${self.usdt_balance:.2f})")
            return None

        self.usdt_balance -= usdt_spent  # tentative deduction — rolled back if DB write fails

        trade_data = {
            "symbol": symbol,
            "side": "buy",
            "entry_price": round(fill_price, 8),
            "exit_price": None,
            "quantity": round(quantity, 8),
            "position_value": round(position_value, 2),
            "stop_loss_price": round(stop_loss_price, 8),
            "take_profit_price": round(take_profit_price, 8),
            "atr_at_entry": round(atr, 8),
            "model_confidence": model_confidence,
            "predicted_return": predicted_return,
            "pnl_usdt": None,
            "pnl_pct": None,
            "exit_reason": None,
            "prediction_correct": None,
            "entry_fee_usdt": round(fee, 4),
            "exit_fee_usdt": None,
            "opened_at": datetime.now(timezone.utc),
            "closed_at": None,
            "paper": True,
            "simulation_run_id": self.simulation_run_id,
        }

        try:
            trade_id = save_trade(trade_data)
        except Exception:
            self.usdt_balance += usdt_spent   # rollback: DB failed, trade never happened
            raise

        self.open_trades[symbol] = {
            "trade_id": trade_id,
            "entry_price": fill_price,
            "quantity": quantity,
            "position_value": position_value,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": take_profit_price,
            "opened_at": trade_data["opened_at"],
            "entry_fee_usdt": fee,
        }

        logger.info(
            f"[PAPER BUY] {symbol}: qty={quantity:.6f} @ ${fill_price:,.2f} "
            f"| value=${position_value:.2f} | fee=${fee:.2f}"
        )
        return trade_id

    def execute_sell(
        self,
        symbol: str,
        exit_price: float,
        exit_reason: str = "manual",
    ) -> Optional[dict]:
        """
        Close a position. Returns P&L info dict or None if no open trade.
        """
        if symbol not in self.open_trades:
            logger.warning(f"Sell rejected: no open position in {symbol}")
            return None

        trade = self.open_trades.pop(symbol)
        trade_id = trade["trade_id"]

        # Apply slippage to exit (sell at slightly lower)
        fill_price = exit_price * (1 - config.SIMULATED_SLIPPAGE_PCT)
        gross_proceeds = trade["quantity"] * fill_price
        exit_fee = gross_proceeds * config.COINBASE_FEE_PCT
        net_proceeds = gross_proceeds - exit_fee

        self.usdt_balance += net_proceeds

        pnl_usdt = net_proceeds - trade["position_value"] - trade["entry_fee_usdt"]
        pnl_pct  = pnl_usdt / trade["position_value"]
        prediction_correct = pnl_usdt > 0 if exit_reason not in ("stop_loss",) else False

        now = datetime.now(timezone.utc)
        update_trade(trade_id, {
            "exit_price": round(fill_price, 8),
            "pnl_usdt": round(pnl_usdt, 4),
            "pnl_pct": round(pnl_pct, 6),
            "exit_reason": exit_reason,
            "prediction_correct": prediction_correct,
            "exit_fee_usdt": round(exit_fee, 4),
            "closed_at": now,
        })

        result = {
            "symbol": symbol,
            "trade_id": trade_id,
            "entry_price": trade["entry_price"],
            "exit_price": fill_price,
            "quantity": trade["quantity"],
            "pnl_usdt": pnl_usdt,
            "pnl_pct": pnl_pct,
            "exit_reason": exit_reason,
        }

        pnl_color = "\033[92m" if pnl_usdt > 0 else "\033[91m"
        logger.info(
            f"[PAPER SELL] {symbol}: {exit_reason} @ ${fill_price:,.2f} "
            f"| P&L: {pnl_color}${pnl_usdt:+.2f} ({pnl_pct:+.2%})\033[0m"
        )
        return result

    def check_stops(self, symbol: str, current_price: float) -> Optional[str]:
        """
        Check if stop-loss or take-profit has been hit.
        Returns exit_reason string or None.
        """
        if symbol not in self.open_trades:
            return None
        trade = self.open_trades[symbol]
        if current_price <= trade["stop_loss_price"]:
            return "stop_loss"
        if current_price >= trade["take_profit_price"]:
            return "take_profit"
        return None

    def close_all_positions(self, get_price_fn, reason: str = "eod_exit") -> list:
        """
        Close all open positions. Used for EOD forced exit.

        Args:
            get_price_fn: Callable that takes symbol and returns current price.
            reason:       Exit reason string.

        Returns:
            List of P&L result dicts.
        """
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
        """Return a summary dict for logging / dashboard."""
        pv = self.portfolio_value(current_prices)
        return {
            "usdt_balance": round(self.usdt_balance, 2),
            "portfolio_value": round(pv, 2),
            "open_positions": list(self.open_trades.keys()),
            "open_count": len(self.open_trades),
            "total_return_pct": (pv - self.starting_usdt) / self.starting_usdt,
        }
