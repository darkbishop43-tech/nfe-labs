CREATE TABLE IF NOT EXISTS v0a_spread_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at TEXT NOT NULL,
  sampled_at_ms INTEGER NOT NULL,
  robinhood_symbol TEXT NOT NULL,
  research_symbol TEXT NOT NULL,
  quote_currency TEXT,
  mapping_confidence TEXT,
  bid REAL NOT NULL,
  ask REAL NOT NULL,
  mark REAL NOT NULL,
  spread REAL NOT NULL,
  spread_pct REAL NOT NULL,
  bid_qty REAL,
  ask_qty REAL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v0a_spread_symbol_time
ON v0a_spread_samples(research_symbol, sampled_at_ms);

CREATE TABLE IF NOT EXISTS v0a_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  robinhood_symbol TEXT NOT NULL,
  research_symbol TEXT NOT NULL,
  research_source TEXT NOT NULL,
  mapping_status TEXT,
  mapping_confidence TEXT,
  quote_currency TEXT,
  research_bid REAL,
  research_ask REAL,
  research_mark REAL,
  research_spread_pct REAL,
  robinhood_bid REAL,
  robinhood_ask REAL,
  robinhood_mark REAL,
  robinhood_provider_timestamp TEXT,
  return_5m REAL,
  return_15m REAL,
  return_1h REAL,
  ema9 REAL,
  ema20 REAL,
  ema50 REAL,
  atr14 REAL,
  atr_percentile REAL,
  volume REAL,
  relative_volume REAL,
  quote_volume REAL,
  taker_buy_base_volume REAL,
  taker_buy_quote_volume REAL,
  trade_count INTEGER,
  dollar_volume REAL,
  q_spread REAL,
  q_liquidity REAL,
  m REAL,
  t REAL,
  v REAL,
  f REAL,
  q REAL,
  n_e REAL,
  n_fr REAL,
  n_tr REAL,
  n_tx REAL,
  n_a REAL,
  n_c REAL,
  si_core_v0a REAL,
  full_si REAL,
  full_si_state TEXT,
  data_freshness TEXT,
  missing_input_flags TEXT
);

CREATE INDEX IF NOT EXISTS idx_v0a_observations_symbol_time
ON v0a_observations(research_symbol, observed_at_ms);

CREATE TABLE IF NOT EXISTS v0a_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  horizon_minutes INTEGER NOT NULL,
  due_at_ms INTEGER NOT NULL,
  start_mark REAL NOT NULL,
  reconciled_at TEXT,
  reconciled_at_ms INTEGER,
  end_mark REAL,
  outcome_return REAL,
  mfe REAL,
  mae REAL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  UNIQUE(observation_id, horizon_minutes),
  FOREIGN KEY(observation_id) REFERENCES v0a_observations(id)
);

CREATE INDEX IF NOT EXISTS idx_v0a_outcomes_status_due
ON v0a_outcomes(status, due_at_ms);
