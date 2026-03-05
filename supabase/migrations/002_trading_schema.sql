-- ============================================================
--  Trading System Schema — Supabase PostgreSQL
--  Run in: Supabase > SQL Editor > New query
-- ============================================================

CREATE TABLE IF NOT EXISTS trades (
    id                SERIAL PRIMARY KEY,
    symbol            VARCHAR(20)  NOT NULL,
    side              VARCHAR(4)   NOT NULL,
    entry_price       FLOAT        NOT NULL,
    exit_price        FLOAT,
    quantity          FLOAT        NOT NULL,
    position_value    FLOAT        NOT NULL,
    stop_loss_price   FLOAT        NOT NULL,
    take_profit_price FLOAT        NOT NULL,
    atr_at_entry      FLOAT,
    model_confidence  FLOAT,
    predicted_return  FLOAT,
    pnl_usdt          FLOAT,
    pnl_pct           FLOAT,
    exit_reason       VARCHAR(30),
    prediction_correct BOOLEAN,
    entry_fee_usdt    FLOAT,
    exit_fee_usdt     FLOAT,
    opened_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    closed_at         TIMESTAMPTZ,
    paper             BOOLEAN      NOT NULL DEFAULT TRUE,
    exchange_order_id VARCHAR(100),
    simulation_run_id VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS idx_trades_symbol     ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_sim_run    ON trades(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at  ON trades(opened_at);

CREATE TABLE IF NOT EXISTS daily_stats (
    id                      SERIAL PRIMARY KEY,
    date                    VARCHAR(10)  NOT NULL UNIQUE,
    portfolio_value_start   FLOAT        NOT NULL,
    portfolio_value_end     FLOAT,
    daily_pnl_usdt          FLOAT,
    daily_pnl_pct           FLOAT,
    trades_opened           INT          DEFAULT 0,
    trades_closed           INT          DEFAULT 0,
    trades_won              INT          DEFAULT 0,
    trades_lost             INT          DEFAULT 0,
    kill_switch_triggered   BOOLEAN      DEFAULT FALSE,
    soft_limit_triggered    BOOLEAN      DEFAULT FALSE,
    gatekeeper_result       BOOLEAN,
    gatekeeper_reason       TEXT,
    paper                   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_versions (
    id               SERIAL PRIMARY KEY,
    version_tag      VARCHAR(50)  NOT NULL UNIQUE,
    file_path        VARCHAR(255) NOT NULL,
    train_start      VARCHAR(10)  NOT NULL,
    train_end        VARCHAR(10)  NOT NULL,
    auc_score        FLOAT        NOT NULL,
    wf_auc_mean      FLOAT,
    lgb_wf_auc       FLOAT,
    features_used    TEXT,
    xgb_params       TEXT,
    notes            TEXT,
    is_current       BOOLEAN      NOT NULL DEFAULT FALSE,
    accepted         BOOLEAN      NOT NULL DEFAULT TRUE,
    rejection_reason VARCHAR(200),
    trained_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS heartbeats (
    id        SERIAL PRIMARY KEY,
    job_name  VARCHAR(50)  NOT NULL,
    timestamp TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    status    VARCHAR(20)  DEFAULT 'ok',
    message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_job ON heartbeats(job_name);

CREATE TABLE IF NOT EXISTS kill_switch_log (
    id              SERIAL PRIMARY KEY,
    level           VARCHAR(10)  NOT NULL,
    trigger_pct     FLOAT        NOT NULL,
    portfolio_value FLOAT        NOT NULL,
    message         TEXT,
    discord_sent    BOOLEAN      DEFAULT FALSE,
    email_sent      BOOLEAN      DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ,
    triggered_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulation_results (
    id               SERIAL PRIMARY KEY,
    run_id           VARCHAR(50)  NOT NULL,
    run_date         VARCHAR(10)  NOT NULL,
    sim_start        VARCHAR(10)  NOT NULL,
    sim_end          VARCHAR(10)  NOT NULL,
    total_trades     INT          DEFAULT 0,
    win_rate         FLOAT,
    total_return_pct FLOAT,
    max_drawdown_pct FLOAT,
    sharpe_ratio     FLOAT,
    avg_win_pct      FLOAT,
    avg_loss_pct     FLOAT,
    profit_factor    FLOAT,
    model_version    VARCHAR(50),
    notes            TEXT,
    created_at       TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sim_results_run_id ON simulation_results(run_id);

-- Disable RLS — SQLAlchemy uses postgres role which bypasses RLS anyway
ALTER TABLE trades              DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats         DISABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeats          DISABLE ROW LEVEL SECURITY;
ALTER TABLE kill_switch_log     DISABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_results  DISABLE ROW LEVEL SECURITY;
