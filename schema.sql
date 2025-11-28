PRAGMA foreign_keys = ON;

-- === USERS ===
CREATE TABLE IF NOT EXISTS User (
  user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status       TEXT DEFAULT 'active',
  created_at   INTEGER DEFAULT (strftime('%s','now'))
);

-- === ACCOUNTS ===
CREATE TABLE IF NOT EXISTS Account (
  account_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  cash       REAL DEFAULT 0,
  equity     REAL DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
);

-- === POSITION HOLDINGS ===
CREATE TABLE IF NOT EXISTS Position (
  account_id   INTEGER NOT NULL,
  symbol       TEXT NOT NULL,
  qty          INTEGER DEFAULT 0,
  avg_cost     REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  last_price   REAL,
  name         TEXT,
  updated_at   INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (account_id, symbol),
  FOREIGN KEY (account_id) REFERENCES Account(account_id) ON DELETE CASCADE
);

-- === TRADES ===
CREATE TABLE IF NOT EXISTS Trade (
  trade_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL,
  fill_qty    INTEGER NOT NULL,
  fill_price  REAL NOT NULL,
  commission  REAL DEFAULT 0,
  executed_at INTEGER DEFAULT (strftime('%s','now'))
);

-- === SECURITY ===
CREATE TABLE IF NOT EXISTS Security (
  symbol   TEXT PRIMARY KEY,
  name     TEXT,
  exchange TEXT
);

-- === PRICE CANDLES ===
CREATE TABLE IF NOT EXISTS PriceCandle (
  symbol TEXT NOT NULL,
  ts     INTEGER NOT NULL,
  open   REAL,
  high   REAL,
  low    REAL,
  close  REAL,
  volume INTEGER,
  PRIMARY KEY (symbol, ts),
  FOREIGN KEY (symbol) REFERENCES Security(symbol) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS GameRoom (
  room_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  base_amount    REAL NOT NULL,
  created_by     INTEGER NOT NULL,
  created_at     INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (created_by) REFERENCES User(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS GameRoomParticipant (
  room_id            INTEGER NOT NULL,
  user_id            INTEGER NOT NULL,
  joined_at          INTEGER DEFAULT (strftime('%s','now')),
  starting_principal REAL NOT NULL,
  cash               REAL NOT NULL,
  equity             REAL NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES GameRoom(room_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS GameRoomPosition (
  room_id      INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  symbol       TEXT NOT NULL,
  qty          INTEGER DEFAULT 0,
  avg_cost     REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  last_price   REAL,
  updated_at   INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (room_id, user_id, symbol),
  FOREIGN KEY (room_id, user_id) REFERENCES GameRoomParticipant(room_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS GameRoomHistory (
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  net_worth REAL NOT NULL,
  PRIMARY KEY (room_id, user_id, ts),
  FOREIGN KEY (room_id) REFERENCES GameRoom(room_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
);
