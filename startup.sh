#!/usr/bin/env bash
set -e

if [ "${ENABLE_TRADING_BOT:-false}" != "true" ]; then
    echo "=== Trading bot disabled; service is idling ==="
    exec tail -f /dev/null
fi

XGB="data/models/xgb_model_current.pkl"
LGB="data/models/lgb_model_current.pkl"

if [ ! -f "$XGB" ] || [ ! -f "$LGB" ]; then
    echo "=== First boot: no models found — running setup ==="
    CSV_COUNT=$(ls data/historical/*.csv 2>/dev/null | wc -l || echo 0)
    if [ "$CSV_COUNT" -lt 8 ]; then
        echo ">>> Downloading historical data..."
        python scripts/download_historical_data.py
    fi
    echo ">>> Training models..."
    python scripts/train_model.py
else
    echo "=== Models found on volume — skipping setup ==="
fi

exec python main.py
