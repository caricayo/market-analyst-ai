"""Quick test: buy $5 of XRP using coinbase-advanced-py (not ccxt)."""
import sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv()

from coinbase.rest import RESTClient

api_key    = os.getenv("COINBASE_API_KEY", "")
api_secret = os.getenv("COINBASE_API_SECRET", "").replace("\\n", "\n")

client = RESTClient(api_key=api_key, api_secret=api_secret)

# Current price
product = client.get_product("XRP-USD")
price = float(product["price"])
print(f"XRP/USD: ${price:.4f}")
print(f"Buying $5.00 worth (~{5/price:.2f} XRP)...")

from datetime import datetime, timezone
order_id = f"test_buy_XRPUSD_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}"
print(f"client_order_id: {order_id}")

order = client.market_order_buy(
    client_order_id=order_id,
    product_id="XRP-USD",
    quote_size="5",
)

print(f"Success:        {order['success']}")
print(f"Order ID:       {order.get('order_id') or order.get('success_response', {}).get('order_id')}")
print(f"Full response:  {dict(order)}")
