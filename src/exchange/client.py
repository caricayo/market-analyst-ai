"""
src/exchange/client.py — Exchange client with paper/live toggle.

CRITICAL: This module controls whether real money is used.
On startup it prints a color-coded banner. Paper mode is the safe default.
Never set PAPER_TRADING=False without explicit confirmation.

Architecture:
  Paper mode:  ccxt public client for market data only.
  Live mode:   ccxt public client for market data
               + coinbase-advanced-py RESTClient for all authenticated/order calls.

ccxt is NOT used for authenticated calls — its EC key parsing breaks on
newer Python runtimes. coinbase-advanced-py handles JWT auth natively.
"""

import os
import uuid
from typing import Optional
from loguru import logger
import ccxt

import config


def print_mode_banner():
    """Print a highly visible banner showing paper vs live mode."""
    if config.PAPER_TRADING:
        print()
        print("\033[42m\033[30m" + "=" * 60 + "\033[0m")
        print("\033[42m\033[30m" + "  PAPER TRADING MODE — NO REAL MONEY AT RISK".center(60) + "\033[0m")
        print("\033[42m\033[30m" + "=" * 60 + "\033[0m")
        print()
    else:
        print()
        print("\033[41m\033[97m" + "=" * 60 + "\033[0m")
        print("\033[41m\033[97m" + "  *** LIVE TRADING — REAL MONEY AT RISK ***".center(60) + "\033[0m")
        print("\033[41m\033[97m" + "=" * 60 + "\033[0m")
        print()
        logger.warning("LIVE TRADING MODE ACTIVE — Real money is at risk")


class ExchangeClient:
    """
    Thin wrapper around ccxt (market data) + coinbase-advanced-py (orders).

    In paper mode: ccxt public client only — no auth, no orders.
    In live mode:  ccxt public client for tickers/OHLCV +
                   coinbase-advanced-py RESTClient for all order placement,
                   cancellation, fill-checking, and balance queries.
    """

    def __init__(self):
        print_mode_banner()
        self.paper = config.PAPER_TRADING

        # CDP private keys are stored in .env with literal \n — expand them
        raw_secret = os.getenv("COINBASE_API_SECRET", "")
        self._api_key    = os.getenv("COINBASE_API_KEY", "")
        self._api_secret = raw_secret.replace("\\n", "\n")

        # Always build the public ccxt client for market data (no auth needed)
        self._public = ccxt.coinbase({
            "rateLimit": 150,
            "enableRateLimit": True,
        })

        if not self.paper:
            if not self._api_key or not self._api_secret:
                raise EnvironmentError(
                    "COINBASE_API_KEY and COINBASE_API_SECRET must be set for live trading"
                )
            from coinbase.rest import RESTClient
            self._cb = RESTClient(api_key=self._api_key, api_secret=self._api_secret)
        else:
            self._cb = None

        logger.info(f"ExchangeClient initialized: mode={'PAPER' if self.paper else 'LIVE'}")

    # ─── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _to_product_id(symbol: str) -> str:
        """Convert ccxt symbol format (BTC/USD) to Coinbase product_id (BTC-USD)."""
        return symbol.replace("/", "-")

    # ─── Market data (always public ccxt — no auth required) ─────────────────

    def fetch_ticker(self, symbol: str) -> dict:
        return self._public.fetch_ticker(symbol)

    def fetch_ohlcv(self, symbol: str, timeframe: str = "1h", since=None, limit=300):
        return self._public.fetch_ohlcv(symbol, timeframe, since=since, limit=limit)

    def fetch_order_book(self, symbol: str, limit: int = 5) -> dict:
        return self._public.fetch_order_book(symbol, limit=limit)

    def get_current_price(self, symbol: str) -> float:
        ticker = self.fetch_ticker(symbol)
        return float(ticker["last"])

    def get_daily_volume_usd(self, symbol: str) -> float:
        """Returns 24h quote volume in USD. Used for liquidity checks."""
        ticker = self.fetch_ticker(symbol)
        return float(ticker.get("quoteVolume", 0))

    def is_liquid(self, symbol: str) -> bool:
        """Returns True if 24h volume exceeds MIN_LIQUIDITY_USD."""
        try:
            vol = self.get_daily_volume_usd(symbol)
            return vol >= config.MIN_LIQUIDITY_USD
        except Exception as e:
            logger.warning(f"Liquidity check failed for {symbol}: {e}")
            return False

    # ─── Live order methods — coinbase-advanced-py (live mode only) ───────────

    def place_limit_buy(self, symbol: str, quantity: float, price: float) -> dict:
        """
        Place a GTC limit buy order.

        Returns:
            dict with keys: id (order_id str), status ("open")
        """
        if self.paper:
            raise RuntimeError("place_limit_buy called in paper mode — use PaperPortfolio instead")
        resp = self._cb.limit_order_gtc_buy(
            client_order_id=str(uuid.uuid4()),
            product_id=self._to_product_id(symbol),
            base_size=str(round(quantity, 8)),
            limit_price=str(round(price, 2)),
        )
        if not resp.success:
            raise RuntimeError(f"Limit buy failed for {symbol}: {resp.error_response}")
        order_id = resp.success_response.order_id
        logger.info(f"[LIVE] Limit buy placed: {symbol} qty={quantity} @ {price} | id={order_id}")
        return {"id": order_id, "status": "open"}

    def place_limit_sell(self, symbol: str, quantity: float, price: float) -> dict:
        """Place a GTC limit sell order."""
        if self.paper:
            raise RuntimeError("place_limit_sell called in paper mode — use PaperPortfolio instead")
        resp = self._cb.limit_order_gtc_sell(
            client_order_id=str(uuid.uuid4()),
            product_id=self._to_product_id(symbol),
            base_size=str(round(quantity, 8)),
            limit_price=str(round(price, 2)),
        )
        if not resp.success:
            raise RuntimeError(f"Limit sell failed for {symbol}: {resp.error_response}")
        order_id = resp.success_response.order_id
        logger.info(f"[LIVE] Limit sell placed: {symbol} qty={quantity} @ {price} | id={order_id}")
        return {"id": order_id, "status": "open"}

    def place_market_sell(self, symbol: str, quantity: float) -> dict:
        """Market sell — used for EOD forced exit and kill switch."""
        if self.paper:
            raise RuntimeError("place_market_sell called in paper mode — use PaperPortfolio instead")
        resp = self._cb.market_order_sell(
            client_order_id=str(uuid.uuid4()),
            product_id=self._to_product_id(symbol),
            base_size=str(round(quantity, 8)),
        )
        if not resp.success:
            raise RuntimeError(f"Market sell failed for {symbol}: {resp.error_response}")
        order_id = resp.success_response.order_id
        logger.info(f"[LIVE] Market sell placed: {symbol} qty={quantity} | id={order_id}")
        return {"id": order_id, "status": "open"}

    def cancel_order(self, order_id: str, symbol: str) -> bool:
        """Cancel an open order. Returns True if successfully cancelled."""
        if self.paper:
            raise RuntimeError("cancel_order called in paper mode")
        try:
            resp = self._cb.cancel_orders(order_ids=[order_id])
            success = bool(resp.results and resp.results[0].success)
            if success:
                logger.info(f"[LIVE] Order cancelled: {order_id} ({symbol})")
            else:
                logger.error(f"Cancel rejected for order {order_id} ({symbol})")
            return success
        except Exception as e:
            logger.error(f"Failed to cancel order {order_id}: {e}")
            return False

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        """
        Fetch order status. Returns ccxt-compatible dict.
        Status "closed" means filled; "open" means still pending.
        """
        if self.paper:
            raise RuntimeError("fetch_order called in paper mode")
        resp = self._cb.get_order(order_id)
        order = resp.order
        # Map Coinbase statuses to ccxt-compatible values
        # Coinbase: OPEN, FILLED, CANCELLED, EXPIRED, FAILED, PENDING, QUEUED
        cb_status = getattr(order, "status", "OPEN")
        ccxt_status = "closed" if cb_status == "FILLED" else "open"
        return {
            "id":     order.order_id,
            "status": ccxt_status,
            "filled": float(getattr(order, "filled_size", 0) or 0),
            "price":  float(getattr(order, "average_filled_price", 0) or 0),
        }

    def fetch_balance(self) -> dict:
        """
        Returns account balances as {currency: {free: float, total: float}}.
        Only available in live mode.
        """
        if self.paper:
            raise RuntimeError("fetch_balance called in paper mode — use PaperPortfolio instead")
        resp = self._cb.get_accounts()
        balances = {}
        for account in resp.accounts:
            currency = account.currency
            try:
                free = float(account.available_balance["value"])
            except (TypeError, KeyError, AttributeError):
                free = 0.0
            if free > 0:
                balances[currency] = {"free": free, "total": free}
        return balances
