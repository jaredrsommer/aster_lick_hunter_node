import { db } from './database';

export interface FollowerWallet {
  id?: number;
  name: string;
  apiKey: string;
  secretKey: string;
  enabled: boolean;
  positionSizeMultiplier: number; // 0.5 = 50%, 1.0 = 100%, 2.0 = 200%
  maxPositionsPerPair: number;
  symbolsFilter?: string[]; // null/undefined = copy all symbols
  createdAt?: number;
  updatedAt?: number;
}

export interface FollowerPosition {
  id?: number;
  walletId: number;
  masterOrderId?: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  quantity: number;
  entryPrice: number;
  leverage: number;
  tpOrderId?: number;
  slOrderId?: number;
  tpPrice?: number;
  slPrice?: number;
  status: 'open' | 'closed' | 'error';
  openedAt: number;
  closedAt?: number;
  closePrice?: number;
  pnl?: number;
  errorMessage?: string;
}

class CopyTradingDb {
  // ===== Follower Wallet Management =====

  async addFollowerWallet(wallet: FollowerWallet): Promise<number> {
    const symbolsFilterJson = wallet.symbolsFilter ? JSON.stringify(wallet.symbolsFilter) : null;
    const now = Math.floor(Date.now() / 1000);

    const result = await db.run(
      `INSERT INTO follower_wallets (
        name, api_key, secret_key, enabled, position_size_multiplier,
        max_positions_per_pair, symbols_filter, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        wallet.name,
        wallet.apiKey,
        wallet.secretKey,
        wallet.enabled ? 1 : 0,
        wallet.positionSizeMultiplier,
        wallet.maxPositionsPerPair,
        symbolsFilterJson,
        now,
        now
      ]
    );

    // SQLite returns lastID via this context
    return (result as any).lastID;
  }

  async updateFollowerWallet(id: number, updates: Partial<FollowerWallet>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.apiKey !== undefined) {
      fields.push('api_key = ?');
      values.push(updates.apiKey);
    }
    if (updates.secretKey !== undefined) {
      fields.push('secret_key = ?');
      values.push(updates.secretKey);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.positionSizeMultiplier !== undefined) {
      fields.push('position_size_multiplier = ?');
      values.push(updates.positionSizeMultiplier);
    }
    if (updates.maxPositionsPerPair !== undefined) {
      fields.push('max_positions_per_pair = ?');
      values.push(updates.maxPositionsPerPair);
    }
    if (updates.symbolsFilter !== undefined) {
      fields.push('symbols_filter = ?');
      values.push(updates.symbolsFilter ? JSON.stringify(updates.symbolsFilter) : null);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);

    await db.run(
      `UPDATE follower_wallets SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  async removeFollowerWallet(id: number): Promise<void> {
    await db.run('DELETE FROM follower_wallets WHERE id = ?', [id]);
  }

  async getFollowerWallet(id: number): Promise<FollowerWallet | null> {
    const row = await db.get('SELECT * FROM follower_wallets WHERE id = ?', [id]);
    return row ? this.mapWalletRow(row) : null;
  }

  async getFollowerWallets(enabledOnly: boolean = false): Promise<FollowerWallet[]> {
    const sql = enabledOnly
      ? 'SELECT * FROM follower_wallets WHERE enabled = 1 ORDER BY created_at ASC'
      : 'SELECT * FROM follower_wallets ORDER BY created_at ASC';

    const rows = await db.all(sql);
    return rows.map(row => this.mapWalletRow(row));
  }

  async getFollowerWalletByName(name: string): Promise<FollowerWallet | null> {
    const row = await db.get('SELECT * FROM follower_wallets WHERE name = ?', [name]);
    return row ? this.mapWalletRow(row) : null;
  }

  // ===== Follower Position Management =====

  async recordFollowerPosition(position: FollowerPosition): Promise<number> {
    const result = await db.run(
      `INSERT INTO follower_positions (
        wallet_id, master_order_id, symbol, side, position_side, quantity,
        entry_price, leverage, tp_order_id, sl_order_id, tp_price, sl_price,
        status, opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        position.walletId,
        position.masterOrderId || null,
        position.symbol,
        position.side,
        position.positionSide,
        position.quantity,
        position.entryPrice,
        position.leverage,
        position.tpOrderId || null,
        position.slOrderId || null,
        position.tpPrice || null,
        position.slPrice || null,
        position.status,
        position.openedAt
      ]
    );

    return (result as any).lastID;
  }

  async updateFollowerPosition(id: number, updates: Partial<FollowerPosition>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.tpOrderId !== undefined) {
      fields.push('tp_order_id = ?');
      values.push(updates.tpOrderId);
    }
    if (updates.slOrderId !== undefined) {
      fields.push('sl_order_id = ?');
      values.push(updates.slOrderId);
    }
    if (updates.tpPrice !== undefined) {
      fields.push('tp_price = ?');
      values.push(updates.tpPrice);
    }
    if (updates.slPrice !== undefined) {
      fields.push('sl_price = ?');
      values.push(updates.slPrice);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.closedAt !== undefined) {
      fields.push('closed_at = ?');
      values.push(updates.closedAt);
    }
    if (updates.closePrice !== undefined) {
      fields.push('close_price = ?');
      values.push(updates.closePrice);
    }
    if (updates.pnl !== undefined) {
      fields.push('pnl = ?');
      values.push(updates.pnl);
    }
    if (updates.errorMessage !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.errorMessage);
    }

    if (fields.length === 0) return;

    values.push(id);

    await db.run(
      `UPDATE follower_positions SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  async getFollowerPosition(id: number): Promise<FollowerPosition | null> {
    const row = await db.get('SELECT * FROM follower_positions WHERE id = ?', [id]);
    return row ? this.mapPositionRow(row) : null;
  }

  async getFollowerPositions(walletId?: number, status?: 'open' | 'closed' | 'error'): Promise<FollowerPosition[]> {
    let sql = 'SELECT * FROM follower_positions WHERE 1=1';
    const params: any[] = [];

    if (walletId !== undefined) {
      sql += ' AND wallet_id = ?';
      params.push(walletId);
    }

    if (status !== undefined) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY opened_at DESC';

    const rows = await db.all(sql, params);
    return rows.map(row => this.mapPositionRow(row));
  }

  async getPositionsByMasterOrderId(masterOrderId: number): Promise<FollowerPosition[]> {
    const rows = await db.all(
      'SELECT * FROM follower_positions WHERE master_order_id = ? AND status = ?',
      [masterOrderId, 'open']
    );
    return rows.map(row => this.mapPositionRow(row));
  }

  async getOpenPositionsForWallet(walletId: number): Promise<FollowerPosition[]> {
    const rows = await db.all(
      'SELECT * FROM follower_positions WHERE wallet_id = ? AND status = ? ORDER BY opened_at DESC',
      [walletId, 'open']
    );
    return rows.map(row => this.mapPositionRow(row));
  }

  async getPositionCountBySymbolSide(walletId: number, symbol: string, positionSide: string): Promise<number> {
    const row = await db.get(
      `SELECT COUNT(*) as count FROM follower_positions
       WHERE wallet_id = ? AND symbol = ? AND position_side = ? AND status = ?`,
      [walletId, symbol, positionSide, 'open']
    );
    return row ? row.count : 0;
  }

  async closeFollowerPosition(id: number, closePrice: number, pnl: number): Promise<void> {
    await this.updateFollowerPosition(id, {
      status: 'closed',
      closedAt: Math.floor(Date.now() / 1000),
      closePrice,
      pnl
    });
  }

  async markPositionError(id: number, errorMessage: string): Promise<void> {
    await this.updateFollowerPosition(id, {
      status: 'error',
      errorMessage
    });
  }

  // ===== Statistics =====

  async getWalletStats(walletId: number): Promise<{
    totalTrades: number;
    openPositions: number;
    closedPositions: number;
    totalPnL: number;
    winRate: number;
  }> {
    const stats = await db.get(
      `SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_positions,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_positions,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN pnl ELSE 0 END), 0) as total_pnl,
        COALESCE(SUM(CASE WHEN status = 'closed' AND pnl > 0 THEN 1 ELSE 0 END), 0) as winning_trades
      FROM follower_positions WHERE wallet_id = ?`,
      [walletId]
    );

    const winRate = stats.closed_positions > 0
      ? (stats.winning_trades / stats.closed_positions) * 100
      : 0;

    return {
      totalTrades: stats.total_trades || 0,
      openPositions: stats.open_positions || 0,
      closedPositions: stats.closed_positions || 0,
      totalPnL: stats.total_pnl || 0,
      winRate
    };
  }

  // ===== Helper Methods =====

  private mapWalletRow(row: any): FollowerWallet {
    return {
      id: row.id,
      name: row.name,
      apiKey: row.api_key,
      secretKey: row.secret_key,
      enabled: row.enabled === 1,
      positionSizeMultiplier: row.position_size_multiplier,
      maxPositionsPerPair: row.max_positions_per_pair,
      symbolsFilter: row.symbols_filter ? JSON.parse(row.symbols_filter) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapPositionRow(row: any): FollowerPosition {
    return {
      id: row.id,
      walletId: row.wallet_id,
      masterOrderId: row.master_order_id,
      symbol: row.symbol,
      side: row.side,
      positionSide: row.position_side,
      quantity: row.quantity,
      entryPrice: row.entry_price,
      leverage: row.leverage,
      tpOrderId: row.tp_order_id,
      slOrderId: row.sl_order_id,
      tpPrice: row.tp_price,
      slPrice: row.sl_price,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      closePrice: row.close_price,
      pnl: row.pnl,
      errorMessage: row.error_message
    };
  }
}

export const copyTradingDb = new CopyTradingDb();
