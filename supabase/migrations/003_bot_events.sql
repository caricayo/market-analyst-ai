-- 003_bot_events.sql — Live feed event log for the dashboard

CREATE TABLE IF NOT EXISTS bot_events (
    id          BIGSERIAL PRIMARY KEY,
    event_type  VARCHAR(50)  NOT NULL,   -- 'gatekeeper', 'coin_score', 'trade_open', 'trade_close', 'system'
    level       VARCHAR(10)  NOT NULL DEFAULT 'info',  -- 'info', 'warn', 'error'
    symbol      VARCHAR(20)  NULL,       -- set for coin-specific events
    message     TEXT         NOT NULL,
    data        JSONB        NULL,       -- structured payload (scores, prices, etc.)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_events_created_at ON bot_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_event_type ON bot_events(event_type);

-- Allow realtime replication
ALTER TABLE bot_events REPLICA IDENTITY FULL;
ALTER TABLE bot_events DISABLE ROW LEVEL SECURITY;
