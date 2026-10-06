-- NFE-OS Robinhood execution lifecycle state. Server-authoritative. Starts DISARMED.
CREATE TABLE IF NOT EXISTS robinhood_execution_control (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS robinhood_execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_robinhood_execution_events_time ON robinhood_execution_events(observed_at);
INSERT OR IGNORE INTO robinhood_execution_control(singleton_id,state_json,updated_at)
VALUES(1,'{"armed":false,"state":"DISARMED","specimen":null,"specimenFp":null,"approval":null,"entryIntent":null,"provider":null,"owned":null,"exitIntent":null,"reconciliation":"FLAT","record":null}',datetime('now'));
