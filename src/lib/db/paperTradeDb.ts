import { db } from './database';

export interface PaperTrade {
  id?: number;
  symbol: string;
  side: string;
  position_side: string;
  quantity: number;
  entry_price: number;
  exit_price?: number;
  leverage: number;
  margin: number;
  status: 'open' | 'closed';
  opened_at: number;
  closed_at?: number;
  close_reason?: string;
  pnl?: number;
  pnl_percent?: number;
  duration_seconds?: number;
  max_pnl?: number;
  min_pnl?: number;
  metadata?: string;
}

export interface PaperTradeStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  totalPnL: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgPnL: number;
  avgWinningPnL: number;
  avgLosingPnL: number;
  bestTrade: number;
  worstTrade: number;
  avgDuration: number;
}

class PaperTradeDb {
  /**
   * Save a new paper trade when position is opened
   */
  async saveTrade(trade: Omit<PaperTrade, 'id'>): Promise<number> {
    const sql = `
      INSERT INTO paper_trades (
        symbol, side, position_side, quantity, entry_price,
        leverage, margin, status, opened_at, max_pnl, min_pnl, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      trade.symbol,
      trade.side,
      trade.position_side,
      trade.quantity,
      trade.entry_price,
      trade.leverage,
      trade.margin,
      trade.status || 'open',
      trade.opened_at,
      trade.max_pnl || 0,
      trade.min_pnl || 0,
      trade.metadata || null,
    ];

    return new Promise((resolve, reject) => {
      db['db'].run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  /**
   * Update an existing paper trade (for tracking max/min PnL)
   */
  async updateTrade(id: number, updates: Partial<PaperTrade>): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.pnl !== undefined) {
      fields.push('pnl = ?');
      params.push(updates.pnl);
    }
    if (updates.max_pnl !== undefined) {
      fields.push('max_pnl = ?');
      params.push(updates.max_pnl);
    }
    if (updates.min_pnl !== undefined) {
      fields.push('min_pnl = ?');
      params.push(updates.min_pnl);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      params.push(updates.metadata);
    }

    if (fields.length === 0) return;

    params.push(id);
    const sql = `UPDATE paper_trades SET ${fields.join(', ')} WHERE id = ?`;

    await db.run(sql, params);
  }

  /**
   * Close a paper trade
   */
  async closeTrade(
    id: number,
    exitPrice: number,
    pnl: number,
    pnlPercent: number,
    closeReason: string
  ): Promise<void> {
    const sql = `
      UPDATE paper_trades
      SET
        exit_price = ?,
        pnl = ?,
        pnl_percent = ?,
        close_reason = ?,
        status = 'closed',
        closed_at = ?,
        duration_seconds = ? - opened_at
      WHERE id = ?
    `;

    const closedAt = Date.now();
    const params = [exitPrice, pnl, pnlPercent, closeReason, closedAt, closedAt, id];

    await db.run(sql, params);
  }

  /**
   * Get a paper trade by ID
   */
  async getTrade(id: number): Promise<PaperTrade | undefined> {
    const sql = 'SELECT * FROM paper_trades WHERE id = ?';
    return await db.get<PaperTrade>(sql, [id]);
  }

  /**
   * Get open paper trade by symbol and position side
   */
  async getOpenTrade(symbol: string, positionSide: string): Promise<PaperTrade | undefined> {
    const sql = `
      SELECT * FROM paper_trades
      WHERE symbol = ? AND position_side = ? AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
    `;
    return await db.get<PaperTrade>(sql, [symbol, positionSide]);
  }

  /**
   * Get all open paper trades
   */
  async getOpenTrades(): Promise<PaperTrade[]> {
    const sql = 'SELECT * FROM paper_trades WHERE status = \'open\' ORDER BY opened_at DESC';
    return await db.all<PaperTrade>(sql);
  }

  /**
   * Get all paper trades with optional filters
   */
  async getTrades(filters?: {
    symbol?: string;
    status?: 'open' | 'closed';
    limit?: number;
    offset?: number;
  }): Promise<PaperTrade[]> {
    let sql = 'SELECT * FROM paper_trades WHERE 1=1';
    const params: any[] = [];

    if (filters?.symbol) {
      sql += ' AND symbol = ?';
      params.push(filters.symbol);
    }

    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY opened_at DESC';

    if (filters?.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);

      if (filters?.offset) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    return await db.all<PaperTrade>(sql, params);
  }

  /**
   * Get paper trading statistics
   */
  async getStats(filters?: { symbol?: string; startDate?: number; endDate?: number }): Promise<PaperTradeStats> {
    let sql = 'SELECT * FROM paper_trades WHERE 1=1';
    const params: any[] = [];

    if (filters?.symbol) {
      sql += ' AND symbol = ?';
      params.push(filters.symbol);
    }

    if (filters?.startDate) {
      sql += ' AND opened_at >= ?';
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      sql += ' AND opened_at <= ?';
      params.push(filters.endDate);
    }

    const trades = await db.all<PaperTrade>(sql, params);

    const openTrades = trades.filter(t => t.status === 'open');
    const closedTrades = trades.filter(t => t.status === 'closed');
    const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.pnl || 0) < 0);

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgPnL = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;

    const winningPnL = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgWinningPnL = winningTrades.length > 0 ? winningPnL / winningTrades.length : 0;

    const losingPnL = losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgLosingPnL = losingTrades.length > 0 ? losingPnL / losingTrades.length : 0;

    const pnls = closedTrades.map(t => t.pnl || 0);
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0;
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0;

    const durations = closedTrades.filter(t => t.duration_seconds).map(t => t.duration_seconds || 0);
    const avgDuration = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;

    return {
      totalTrades: trades.length,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      totalPnL,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
      avgPnL,
      avgWinningPnL,
      avgLosingPnL,
      bestTrade,
      worstTrade,
      avgDuration,
    };
  }

  /**
   * Delete old paper trades (cleanup)
   */
  async deleteOldTrades(daysToKeep: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const sql = 'DELETE FROM paper_trades WHERE closed_at < ? AND status = \'closed\'';

    return new Promise((resolve, reject) => {
      db['db'].run(sql, [cutoffTime], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  /**
   * Get paper trade history grouped by day
   */
  async getDailyStats(days: number = 30): Promise<Array<{ date: string; trades: number; pnl: number }>> {
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const sql = `
      SELECT
        DATE(opened_at / 1000, 'unixepoch') as date,
        COUNT(*) as trades,
        SUM(COALESCE(pnl, 0)) as pnl
      FROM paper_trades
      WHERE opened_at >= ? AND status = 'closed'
      GROUP BY date
      ORDER BY date DESC
    `;

    return await db.all<{ date: string; trades: number; pnl: number }>(sql, [startTime]);
  }
}

export const paperTradeDb = new PaperTradeDb();
