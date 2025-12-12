-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    public_key TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_active INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_public_key ON users(public_key);

-- Trade history
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    input_mint TEXT NOT NULL,
    output_mint TEXT NOT NULL,
    input_symbol TEXT NOT NULL,
    output_symbol TEXT NOT NULL,
    in_amount TEXT NOT NULL,
    out_amount TEXT NOT NULL,
    tx_signature TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    price_impact_pct TEXT,
    platform_fee TEXT,
    volume_usd REAL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);

-- Points system
CREATE TABLE IF NOT EXISTS user_points (
    user_id TEXT PRIMARY KEY,
    total_points INTEGER NOT NULL DEFAULT 0,
    trade_count INTEGER NOT NULL DEFAULT 0,
    volume_usd REAL NOT NULL DEFAULT 0,
    weekly_points INTEGER NOT NULL DEFAULT 0,
    week_start INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_points_weekly ON user_points(week_start, weekly_points DESC);
CREATE INDEX IF NOT EXISTS idx_points_total ON user_points(total_points DESC);

-- Auto-trading strategies
CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('buy_dip', 'take_profit')),
    trigger_price REAL NOT NULL,
    amount TEXT NOT NULL,
    slippage_bps INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'triggered', 'executed', 'failed')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    executed_at INTEGER,
    tx_signature TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);
CREATE INDEX IF NOT EXISTS idx_strategies_token ON strategies(token_mint);

-- Strategy execution log
CREATE TABLE IF NOT EXISTS strategy_executions (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    trigger_price REAL NOT NULL,
    actual_price REAL NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    tx_signature TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
);

CREATE INDEX IF NOT EXISTS idx_executions_strategy ON strategy_executions(strategy_id);

-- Token cache
CREATE TABLE IF NOT EXISTS token_cache (
    mint TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    logo_uri TEXT,
    last_price REAL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_token_symbol ON token_cache(symbol);
