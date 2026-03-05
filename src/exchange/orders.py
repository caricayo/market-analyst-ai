"""
src/exchange/orders.py — Order lifecycle management including unfilled timeout.

Handles the 10-minute unfilled order cancellation logic for live trading.
In paper mode, orders are considered filled immediately.
"""

import time
import threading
from datetime import datetime, timezone
from typing import Optional, Callable
from loguru import logger

import config
from src.exchange.client import ExchangeClient


class OrderManager:
    """
    Manages order placement and 10-minute unfilled timeout.

    For paper mode: Orders are virtual (handled by PaperPortfolio).
    For live mode: Places real limit orders, monitors fill status,
                   cancels after ORDER_FILL_TIMEOUT_SECONDS.
    """

    def __init__(self, client: ExchangeClient):
        self.client = client
        self._pending: dict[str, dict] = {}   # order_id → order info
        self._lock = threading.Lock()

    def place_buy_with_timeout(
        self,
        symbol: str,
        quantity: float,
        price: float,
        on_filled: Callable = None,
        on_timeout: Callable = None,
    ) -> Optional[str]:
        """
        Place a limit buy order with automatic timeout cancellation.

        Live mode: Submits to exchange, starts a background timer.
                   If not filled in ORDER_FILL_TIMEOUT_SECONDS → cancel.
        Paper mode: Should not be called (PaperPortfolio handles buys directly).

        Args:
            symbol:     e.g. "BTC/USDT"
            quantity:   Base asset amount.
            price:      Limit price.
            on_filled:  Callback(symbol, order_id) when order fills.
            on_timeout: Callback(symbol, order_id) when order times out.

        Returns:
            order_id string or None on failure.
        """
        if self.client.paper:
            raise RuntimeError("OrderManager.place_buy_with_timeout called in paper mode")

        try:
            order = self.client.place_limit_buy(symbol, quantity, price)
            order_id = order["id"]
            placed_at = datetime.now(timezone.utc)

            with self._lock:
                self._pending[order_id] = {
                    "symbol": symbol,
                    "order_id": order_id,
                    "quantity": quantity,
                    "price": price,
                    "placed_at": placed_at,
                    "status": "open",
                }

            # Start timeout monitor in background thread
            t = threading.Timer(
                config.ORDER_FILL_TIMEOUT_SECONDS,
                self._handle_timeout,
                args=[order_id, symbol, on_timeout],
            )
            t.daemon = True
            t.start()

            logger.info(
                f"[ORDER] Limit buy placed: {symbol} qty={quantity:.6f} @ ${price:,.2f} "
                f"| timeout in {config.ORDER_FILL_TIMEOUT_SECONDS // 60} min"
            )
            return order_id

        except Exception as e:
            logger.error(f"Failed to place buy for {symbol}: {e}")
            return None

    def _handle_timeout(self, order_id: str, symbol: str, on_timeout: Callable = None):
        """Called by timer if order hasn't filled. Cancels and logs."""
        with self._lock:
            order_info = self._pending.get(order_id)
            if not order_info or order_info["status"] != "open":
                return   # Already filled or cancelled

        logger.warning(
            f"[TIMEOUT] Order {order_id} for {symbol} not filled in "
            f"{config.ORDER_FILL_TIMEOUT_SECONDS // 60} min — cancelling"
        )

        cancelled = self.client.cancel_order(order_id, symbol)
        if cancelled:
            with self._lock:
                if order_id in self._pending:
                    self._pending[order_id]["status"] = "timeout"

            logger.info(f"[TIMEOUT] {symbol} order cancelled — skipping coin")

            if on_timeout:
                try:
                    on_timeout(symbol, order_id)
                except Exception as e:
                    logger.error(f"on_timeout callback failed: {e}")

    def mark_filled(self, order_id: str):
        """Call this when an order fill is confirmed."""
        with self._lock:
            if order_id in self._pending:
                self._pending[order_id]["status"] = "filled"

    def check_fills(self) -> list[dict]:
        """
        Poll all pending open orders for fill status.
        Returns list of newly-filled order dicts.
        """
        if self.client.paper:
            return []

        filled = []
        with self._lock:
            pending_ids = [
                (oid, info) for oid, info in self._pending.items()
                if info["status"] == "open"
            ]

        for order_id, info in pending_ids:
            try:
                order = self.client.fetch_order(order_id, info["symbol"])
                if order["status"] == "closed":
                    self.mark_filled(order_id)
                    filled.append(order)
                    logger.info(f"[FILLED] {info['symbol']} order {order_id}")
            except Exception as e:
                logger.warning(f"Could not check order {order_id}: {e}")

        return filled

    def get_pending(self) -> list[dict]:
        with self._lock:
            return [v for v in self._pending.values() if v["status"] == "open"]
