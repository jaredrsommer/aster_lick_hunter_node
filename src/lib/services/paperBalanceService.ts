import { EventEmitter } from 'events';
import { db } from '../db/database';

export interface PaperBalance {
  totalBalance: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnL: number;
  realizedPnL: number;
  lastUpdate: number;
}

interface PaperPosition {
  symbol: string;
  margin: number;
  pnl: number;
}

/**
 * Paper Balance Service
 *
 * Manages virtual balance for paper trading mode:
 * - Tracks starting balance (default 10,000 USDT)
 * - Calculates used margin from open positions
 * - Tracks realized P&L from closed positions
 * - Calculates unrealized P&L from open positions
 * - Persists state to database
 * - Broadcasts updates to UI via events
 */
class PaperBalanceService extends EventEmitter {
  private startingBalance: number = 10000; // Default starting balance in USDT
  private realizedPnL: number = 0; // Cumulative realized P&L from closed positions
  private positions: Map<string, PaperPosition> = new Map(); // symbol_side -> position
  private isInitialized: boolean = false;
  private lastUpdate: number = 0;
  private lastEmit: number = 0;
  private emitThrottleMs: number = 2000; // Throttle emissions to once per 2 seconds
  private pendingEmit: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize the service with starting balance
   */
  async initialize(startingBalance: number = 10000): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.startingBalance = startingBalance;

    // Try to load persisted state from database
    await this.loadState();

    this.isInitialized = true;
    this.lastUpdate = Date.now();

    console.log('[PaperBalanceService] Initialized with starting balance:', this.startingBalance);
    console.log('[PaperBalanceService] Current realized P&L:', this.realizedPnL);

    this.emitBalanceUpdate();
  }

  /**
   * Reset balance to starting amount (for testing or reset)
   */
  async reset(newStartingBalance?: number): Promise<void> {
    if (newStartingBalance !== undefined) {
      this.startingBalance = newStartingBalance;
    }

    this.realizedPnL = 0;
    this.positions.clear();
    this.lastUpdate = Date.now();

    await this.saveState();
    this.emitBalanceUpdate();

    console.log('[PaperBalanceService] Reset to starting balance:', this.startingBalance);
  }

  /**
   * Track a new position opened
   */
  addPosition(symbol: string, side: 'LONG' | 'SHORT', margin: number): void {
    const key = `${symbol}_${side}`;
    this.positions.set(key, {
      symbol,
      margin,
      pnl: 0
    });

    this.lastUpdate = Date.now();
    this.saveState();
    this.emitBalanceUpdate();

    console.log(`[PaperBalanceService] Position added: ${key}, margin: ${margin.toFixed(2)} USDT`);
  }

  /**
   * Update unrealized P&L for an open position
   */
  updatePositionPnL(symbol: string, side: 'LONG' | 'SHORT', pnl: number): void {
    const key = `${symbol}_${side}`;
    const position = this.positions.get(key);

    if (position) {
      position.pnl = pnl;
      this.lastUpdate = Date.now();
      // Use debounced emission for PnL updates (these happen very frequently for all positions)
      this.emitBalanceUpdateDebounced();
    }
  }

  /**
   * Close a position and add to realized P&L
   */
  closePosition(symbol: string, side: 'LONG' | 'SHORT', finalPnL: number): void {
    const key = `${symbol}_${side}`;
    const position = this.positions.get(key);

    if (position) {
      this.realizedPnL += finalPnL;
      this.positions.delete(key);

      this.lastUpdate = Date.now();
      this.saveState();
      this.emitBalanceUpdate();

      console.log(`[PaperBalanceService] Position closed: ${key}, P&L: ${finalPnL.toFixed(2)} USDT, Total realized P&L: ${this.realizedPnL.toFixed(2)} USDT`);
    }
  }

  /**
   * Get current balance state
   */
  getBalance(): PaperBalance {
    // Calculate used margin from open positions
    let usedMargin = 0;
    let unrealizedPnL = 0;

    for (const position of this.positions.values()) {
      usedMargin += position.margin;
      unrealizedPnL += position.pnl;
    }

    // Total balance = starting balance + realized P&L
    const totalBalance = this.startingBalance + this.realizedPnL;

    // Available balance = total balance - used margin
    const availableBalance = totalBalance - usedMargin;

    return {
      totalBalance,
      availableBalance,
      usedMargin,
      unrealizedPnL,
      realizedPnL: this.realizedPnL,
      lastUpdate: this.lastUpdate
    };
  }

  /**
   * Check if service is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get starting balance
   */
  getStartingBalance(): number {
    return this.startingBalance;
  }

  /**
   * Load state from database
   */
  private async loadState(): Promise<void> {
    try {
      // Load from paper_balance_state table
      const sql = `SELECT * FROM paper_balance_state ORDER BY id DESC LIMIT 1`;
      const row = await db.get<{
        starting_balance: number;
        realized_pnl: number;
        updated_at: number;
      }>(sql);

      if (row) {
        this.startingBalance = row.starting_balance;
        this.realizedPnL = row.realized_pnl;
        console.log('[PaperBalanceService] Loaded state from database:', {
          startingBalance: this.startingBalance,
          realizedPnL: this.realizedPnL
        });
      }
    } catch (error) {
      // Table might not exist yet, that's okay
      console.log('[PaperBalanceService] No saved state found, using defaults');
    }
  }

  /**
   * Save state to database
   */
  private async saveState(): Promise<void> {
    try {
      const sql = `
        INSERT OR REPLACE INTO paper_balance_state (id, starting_balance, realized_pnl, updated_at)
        VALUES (1, ?, ?, ?)
      `;

      await db.run(sql, [this.startingBalance, this.realizedPnL, Date.now()]);
    } catch (error) {
      console.error('[PaperBalanceService] Failed to save state:', error);
    }
  }

  /**
   * Emit balance update event immediately (for critical updates like position open/close)
   */
  private emitBalanceUpdate(): void {
    const now = Date.now();
    this.lastEmit = now;

    // Clear any pending debounced emission
    if (this.pendingEmit) {
      clearTimeout(this.pendingEmit);
      this.pendingEmit = null;
    }

    const balance = this.getBalance();
    this.emit('balance:update', balance);
  }

  /**
   * Emit balance update with debouncing (for frequent PnL updates)
   * Multiple calls within 2 seconds will be batched into a single emission
   */
  private emitBalanceUpdateDebounced(): void {
    // Clear existing pending emission
    if (this.pendingEmit) {
      clearTimeout(this.pendingEmit);
    }

    // Check if enough time has passed since last emit
    const now = Date.now();
    const timeSinceLastEmit = now - this.lastEmit;

    if (timeSinceLastEmit >= this.emitThrottleMs) {
      // Emit immediately if enough time has passed
      this.emitBalanceUpdate();
    } else {
      // Schedule emission for later
      this.pendingEmit = setTimeout(() => {
        this.emitBalanceUpdate();
        this.pendingEmit = null;
      }, this.emitThrottleMs - timeSinceLastEmit);
    }
  }
}

// Global singleton instance
let paperBalanceServiceInstance: PaperBalanceService | null = null;

/**
 * Get the global PaperBalanceService instance
 */
export function getPaperBalanceService(): PaperBalanceService | null {
  return paperBalanceServiceInstance;
}

/**
 * Initialize and get the global PaperBalanceService instance
 */
export async function initializePaperBalanceService(startingBalance: number = 10000): Promise<PaperBalanceService> {
  if (!paperBalanceServiceInstance) {
    paperBalanceServiceInstance = new PaperBalanceService();
  }

  await paperBalanceServiceInstance.initialize(startingBalance);
  return paperBalanceServiceInstance;
}

/**
 * Reset the paper balance service
 */
export async function resetPaperBalanceService(newStartingBalance?: number): Promise<void> {
  if (paperBalanceServiceInstance) {
    await paperBalanceServiceInstance.reset(newStartingBalance);
  }
}

export default paperBalanceServiceInstance;
