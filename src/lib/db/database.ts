import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'liquidations.db');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export class Database {
  private db: sqlite3.Database;
  private static instance: Database;

  private constructor() {
    this.db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database at:', DB_PATH);
        this.initializeSchema();
      }
    });
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  private initializeSchema(): void {
    const schema = `
      CREATE TABLE IF NOT EXISTS liquidations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        order_type TEXT,
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        average_price REAL,
        volume_usdt REAL NOT NULL,
        order_status TEXT,
        order_last_filled_quantity REAL,
        order_filled_accumulated_quantity REAL,
        order_trade_time INTEGER,
        event_time INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_liquidations_event_time
        ON liquidations(event_time);

      CREATE INDEX IF NOT EXISTS idx_liquidations_symbol
        ON liquidations(symbol);

      CREATE INDEX IF NOT EXISTS idx_liquidations_created_at
        ON liquidations(created_at);

      CREATE INDEX IF NOT EXISTS idx_liquidations_symbol_event_time
        ON liquidations(symbol, event_time);

      CREATE TABLE IF NOT EXISTS follower_wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL,
        secret_key TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        position_size_multiplier REAL DEFAULT 1.0,
        max_positions_per_pair INTEGER DEFAULT 2,
        symbols_filter TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS follower_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_id INTEGER NOT NULL,
        master_order_id INTEGER,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        position_side TEXT NOT NULL,
        quantity REAL NOT NULL,
        entry_price REAL NOT NULL,
        leverage INTEGER NOT NULL,
        tp_order_id INTEGER,
        sl_order_id INTEGER,
        tp_price REAL,
        sl_price REAL,
        status TEXT DEFAULT 'open',
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        close_price REAL,
        pnl REAL,
        error_message TEXT,
        FOREIGN KEY (wallet_id) REFERENCES follower_wallets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_follower_positions_wallet_id
        ON follower_positions(wallet_id);

      CREATE INDEX IF NOT EXISTS idx_follower_positions_status
        ON follower_positions(status);

      CREATE INDEX IF NOT EXISTS idx_follower_positions_symbol
        ON follower_positions(symbol);

      CREATE INDEX IF NOT EXISTS idx_follower_positions_master_order
        ON follower_positions(master_order_id);

      CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        position_side TEXT NOT NULL,
        quantity REAL NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL,
        leverage INTEGER NOT NULL,
        margin REAL NOT NULL,
        status TEXT DEFAULT 'open',
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        close_reason TEXT,
        pnl REAL,
        pnl_percent REAL,
        duration_seconds INTEGER,
        max_pnl REAL DEFAULT 0,
        min_pnl REAL DEFAULT 0,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol
        ON paper_trades(symbol);

      CREATE INDEX IF NOT EXISTS idx_paper_trades_status
        ON paper_trades(status);

      CREATE INDEX IF NOT EXISTS idx_paper_trades_opened_at
        ON paper_trades(opened_at);

      CREATE INDEX IF NOT EXISTS idx_paper_trades_closed_at
        ON paper_trades(closed_at);

      CREATE TABLE IF NOT EXISTS paper_balance_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        starting_balance REAL NOT NULL DEFAULT 10000,
        realized_pnl REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `;

    this.db.exec(schema, (err) => {
      if (err) {
        console.error('Error creating schema:', err);
      } else {
        console.log('Database schema initialized');
      }
    });
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  close(): void {
    this.db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
    });
  }

  async initialize(): Promise<void> {
    // Force initialization if not already done
    return new Promise((resolve) => {
      // Check if database is already open
      if (this.db) {
        resolve();
      } else {
        // Wait a bit for async initialization to complete
        setTimeout(() => resolve(), 100);
      }
    });
  }
}

export const db = Database.getInstance();