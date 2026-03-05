"""
src/exchange/client.py — Exchange client with paper/live toggle.

CRITICAL: This module controls whether real money is used.
On startup it prints a color-coded banner. Paper mode is the safe default.
Never set PAPER_TRADING=False without explicit confirmation.
"""

import os
import time
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
        print("\033[41m\033[97m" + "  ⚠  LIVE TRADING — REAL MONEY AT RISK  ⚠".center(60) + "\033[0m")
        print("\033[41m\033[97m" + "=" * 60 + "\033[0m")
        print()
        logger.warning("LIVE TRADING MODE ACTIVE — Real money is at risk")


class ExchangeClient:
    """
    Thin wrapper around ccxt with paper/live detection.

    In paper mode: uses ccxt for read-only market data (prices, tickers),
    but all order placement is handled by the PaperPortfolio class.

    In live mode: uses ccxt coinbase with real API keys.
    """

    def __init__(self):
        print_mode_banner()
        self.paper = config.PAPER_TRADING

        # CDP private keys are stored in .env with literal \n — expand them
        raw_secret = os.getenv("COINBASE_API_SECRET", "")
        self._api_key    = os.getenv("COINBASE_API_KEY", "")
        self._api_secret = raw_secret.replace("\\n", "\n")

        # Always build the public client for market data (no auth needed)
        self._public = ccxt.coinbase({
            "rateLimit": 150,
            "enableRateLimit": True,
        })

        if not self.paper:
            if not self._api_key or not self._api_secret:
                raise EnvironmentError("COINBASE_API_KEY and COINBASE_API_SECRET must be set for live trading")
            self._private = ccxt.coinbase({
                "apiKey":  self._api_key,
                "secret":  self._api_secret,
                "rateLimit": 150,
                "enableRateLimit": True,
            })
        else:
            self._private = None

        logger.info(f"ExchangeClient initialized: mode={'PAPER' if self.paper else 'LIVE'}")

    # ─── Market data (always public) ─────────────────────────────────────────

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

    # ─── Live order methods (no-op wrapper in paper mode) ─────────────────────

    def place_limit_buy(self, symbol: str, quantity: float, price: float) -> dict:
        """Place a limit buy. Returns order dict. In paper mode, raises if called."""
        if self.paper:
            raise RuntimeError("place_limit_buy called in paper mode — use PaperPortfolio instead")
        order = self._private.create_limit_buy_order(symbol, quantity, price)
        logger.info(f"[LIVE] Limit buy placed: {symbol} qty={quantity} @ {price}")
        return order

    def place_limit_sell(self, symbol: str, quantity: float, price: float) -> dict:
        if self.paper:
            raise RuntimeError("place_limit_sell called in paper mode — use PaperPortfolio instead")
        order = self._private.create_limit_sell_order(symbol, quantity, price)
        logger.info(f"[LIVE] Limit sell placed: {symbol} qty={quantity} @ {price}")
        return order

    def place_market_sell(self, symbol: str, quantity: float) -> dict:
        """Market sell for EOD forced exit or kill switch."""
        if self.paper:
            raise RuntimeError("place_market_sell called in paper mode — use PaperPortfolio instead")
        order = self._private.create_market_sell_order(symbol, quantity)
        logger.info(f"[LIVE] Market sell placed: {symbol} qty={quantity}")
        return order

    def cancel_order(self, order_id: str, symbol: str) -> bool:
        if self.paper:
            raise RuntimeError("cancel_order called in paper mode")
        try:
            self._private.cancel_order(order_id, symbol)
            logger.info(f"[LIVE] Order cancelled: {order_id} ({symbol})")
            return True
        except Exception as e:
            logger.error(f"Failed to cancel order {order_id}: {e}")
            return False

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        if self.paper:
            raise RuntimeError("fetch_order called in paper mode")
        return self._private.fetch_order(order_id, symbol)

    def fetch_balance(self) -> dict:
        if self.paper:
            raise RuntimeError("fetch_balance called in paper mode — use PaperPortfolio instead")
        return self._private.fetch_balance()
