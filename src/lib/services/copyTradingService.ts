import { EventEmitter } from 'events';
import { copyTradingDb, FollowerWallet, FollowerPosition } from '../db/copyTradingDb';
import { placeOrder, cancelOrder, setLeverage } from '../api/orders';
import { placeStopLossAndTakeProfit } from '../api/batchOrders';
import { getPositions, getMarkPrice } from '../api/market';
import { errorLogger } from './errorLogger';
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

interface MasterPositionEvent {
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  quantity: number;
  price: number;
  leverage: number;
}

interface MasterPositionCloseEvent {
  orderId: number;
  symbol: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  closePrice: number;
  pnl: number;
}

interface MasterTPSLUpdateEvent {
  orderId: number;
  symbol: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  tpPrice?: number;
  slPrice?: number;
}

export class CopyTradingService extends EventEmitter {
  private enabled: boolean = false;
  private syncTPSL: boolean = true;
  private syncClose: boolean = true;
  private delayMs: number = 0;
  private isRunning: boolean = false;

  constructor() {
    super();
  }

  async initialize(config: {
    enabled: boolean;
    syncTPSL?: boolean;
    syncClose?: boolean;
    delayMs?: number;
  }): Promise<void> {
    this.enabled = config.enabled;
    this.syncTPSL = config.syncTPSL ?? true;
    this.syncClose = config.syncClose ?? true;
    this.delayMs = config.delayMs ?? 0;

    if (this.enabled) {
      logWithTimestamp('Copy Trading Service: Initialized');
      logWithTimestamp(`  Sync TP/SL: ${this.syncTPSL}`);
      logWithTimestamp(`  Sync Close: ${this.syncClose}`);
      logWithTimestamp(`  Delay: ${this.delayMs}ms`);
      this.isRunning = true;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.isRunning;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logWithTimestamp('Copy Trading Service: Stopped');
  }

  // ===== Master Position Event Handlers =====

  async onMasterPositionOpened(masterPosition: MasterPositionEvent): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      // Optional delay between master and follower trades
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }

      // Get all enabled follower wallets
      const followers = await copyTradingDb.getFollowerWallets(true);

      if (followers.length === 0) {
        return; // No followers configured
      }

      logWithTimestamp(`Copy Trading: Master position opened - ${masterPosition.symbol} ${masterPosition.positionSide} @ ${masterPosition.price}`);
      logWithTimestamp(`Copy Trading: Copying to ${followers.length} follower wallet(s)...`);

      // Place orders on each follower account concurrently
      const results = await Promise.allSettled(
        followers.map(follower => this.copyPositionToFollower(masterPosition, follower))
      );

      // Log results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logWithTimestamp(`Copy Trading: Completed - ${successful} successful, ${failed} failed`);

      // Emit event for UI updates
      this.emit('copyTradeCompleted', {
        masterOrderId: masterPosition.orderId,
        symbol: masterPosition.symbol,
        successful,
        failed,
        totalFollowers: followers.length
      });

    } catch (error) {
      logErrorWithTimestamp('Copy Trading: Error handling master position opened:', error);
      await errorLogger.logError(error, 'CopyTradingService.onMasterPositionOpened', {
        masterPosition
      });
    }
  }

  async onMasterPositionClosed(closeEvent: MasterPositionCloseEvent): Promise<void> {
    if (!this.isEnabled() || !this.syncClose) return;

    try {
      logWithTimestamp(`Copy Trading: Master position closed - ${closeEvent.symbol} ${closeEvent.positionSide}`);

      // Find all linked follower positions
      const followerPositions = await copyTradingDb.getPositionsByMasterOrderId(closeEvent.orderId);

      if (followerPositions.length === 0) {
        return; // No follower positions to close
      }

      logWithTimestamp(`Copy Trading: Closing ${followerPositions.length} follower position(s)...`);

      // Close each follower position
      const results = await Promise.allSettled(
        followerPositions.map(pos => this.closeFollowerPosition(pos))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logWithTimestamp(`Copy Trading: Closed positions - ${successful} successful, ${failed} failed`);

      this.emit('closeTradeCompleted', {
        masterOrderId: closeEvent.orderId,
        symbol: closeEvent.symbol,
        successful,
        failed,
        totalPositions: followerPositions.length
      });

    } catch (error) {
      logErrorWithTimestamp('Copy Trading: Error closing follower positions:', error);
      await errorLogger.logError(error, 'CopyTradingService.onMasterPositionClosed', {
        closeEvent
      });
    }
  }

  async onMasterTPSLUpdate(updateEvent: MasterTPSLUpdateEvent): Promise<void> {
    if (!this.isEnabled() || !this.syncTPSL) return;

    try {
      // Find all linked follower positions
      const followerPositions = await copyTradingDb.getPositionsByMasterOrderId(updateEvent.orderId);

      if (followerPositions.length === 0) {
        return;
      }

      logWithTimestamp(`Copy Trading: Updating TP/SL for ${followerPositions.length} follower position(s)...`);

      // Update TP/SL for each follower position
      const results = await Promise.allSettled(
        followerPositions.map(pos => this.updateFollowerTPSL(pos, updateEvent))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logWithTimestamp(`Copy Trading: TP/SL updated - ${successful} successful, ${failed} failed`);

    } catch (error) {
      logErrorWithTimestamp('Copy Trading: Error updating follower TP/SL:', error);
    }
  }

  // ===== Private Helper Methods =====

  private async copyPositionToFollower(
    masterPosition: MasterPositionEvent,
    follower: FollowerWallet
  ): Promise<void> {
    try {
      // Check if follower's symbol filter allows this symbol
      if (follower.symbolsFilter && follower.symbolsFilter.length > 0) {
        if (!follower.symbolsFilter.includes(masterPosition.symbol)) {
          logWithTimestamp(`Copy Trading: Skipping ${follower.name} - symbol ${masterPosition.symbol} not in filter`);
          return;
        }
      }

      // Check follower position limits
      const currentCount = await copyTradingDb.getPositionCountBySymbolSide(
        follower.id!,
        masterPosition.symbol,
        masterPosition.positionSide
      );

      if (currentCount >= follower.maxPositionsPerPair) {
        logWarnWithTimestamp(`Copy Trading: ${follower.name} - Max positions (${follower.maxPositionsPerPair}) reached for ${masterPosition.symbol} ${masterPosition.positionSide}`);
        return;
      }

      // Calculate follower position size
      const followerQuantity = masterPosition.quantity * follower.positionSizeMultiplier;

      logWithTimestamp(`Copy Trading: Opening position for ${follower.name}`);
      logWithTimestamp(`  Symbol: ${masterPosition.symbol}`);
      logWithTimestamp(`  Side: ${masterPosition.side} (${masterPosition.positionSide})`);
      logWithTimestamp(`  Master quantity: ${masterPosition.quantity}`);
      logWithTimestamp(`  Follower quantity: ${followerQuantity} (${follower.positionSizeMultiplier * 100}% of master)`);
      logWithTimestamp(`  Leverage: ${masterPosition.leverage}x`);

      // Set leverage for follower
      const followerCredentials = {
        apiKey: follower.apiKey,
        secretKey: follower.secretKey
      };

      await setLeverage(masterPosition.symbol, masterPosition.leverage, followerCredentials);

      // Place the order on follower account
      const order = await placeOrder({
        symbol: masterPosition.symbol,
        side: masterPosition.side,
        type: 'MARKET',
        quantity: followerQuantity,
        positionSide: masterPosition.positionSide
      }, followerCredentials);

      logWithTimestamp(`Copy Trading: ${follower.name} - Order placed, orderId: ${order.orderId}`);

      // Record the follower position in database
      const positionId = await copyTradingDb.recordFollowerPosition({
        walletId: follower.id!,
        masterOrderId: masterPosition.orderId,
        symbol: masterPosition.symbol,
        side: masterPosition.side,
        positionSide: masterPosition.positionSide,
        quantity: followerQuantity,
        entryPrice: parseFloat(order.avgPrice || order.price || '0'),
        leverage: masterPosition.leverage,
        status: 'open',
        openedAt: Math.floor(Date.now() / 1000)
      });

      // Place TP/SL orders if configured
      // This would typically come from the master position's TP/SL settings
      // For now, we'll emit an event to let the caller handle this
      this.emit('followerPositionOpened', {
        positionId,
        walletName: follower.name,
        symbol: masterPosition.symbol,
        side: masterPosition.positionSide,
        quantity: followerQuantity,
        orderId: order.orderId
      });

      logWithTimestamp(`Copy Trading: ${follower.name} - Position recorded (ID: ${positionId})`);

    } catch (error: any) {
      logErrorWithTimestamp(`Copy Trading: Failed to copy position to ${follower.name}:`, error);

      // Record the error in database if we have a wallet ID
      if (follower.id) {
        try {
          const positionId = await copyTradingDb.recordFollowerPosition({
            walletId: follower.id,
            masterOrderId: masterPosition.orderId,
            symbol: masterPosition.symbol,
            side: masterPosition.side,
            positionSide: masterPosition.positionSide,
            quantity: masterPosition.quantity * follower.positionSizeMultiplier,
            entryPrice: masterPosition.price,
            leverage: masterPosition.leverage,
            status: 'error',
            openedAt: Math.floor(Date.now() / 1000),
            errorMessage: error.message || 'Unknown error'
          });

          await copyTradingDb.markPositionError(positionId, error.message || 'Failed to place order');
        } catch (dbError) {
          logErrorWithTimestamp('Copy Trading: Failed to record error in database:', dbError);
        }
      }

      await errorLogger.logError(error, 'CopyTradingService.copyPositionToFollower', {
        followerName: follower.name,
        masterPosition
      });

      throw error; // Re-throw to be caught by Promise.allSettled
    }
  }

  private async closeFollowerPosition(position: FollowerPosition): Promise<void> {
    try {
      // Get follower wallet
      const follower = await copyTradingDb.getFollowerWallet(position.walletId);
      if (!follower) {
        throw new Error(`Follower wallet not found: ${position.walletId}`);
      }

      logWithTimestamp(`Copy Trading: Closing ${follower.name} position for ${position.symbol}`);

      const followerCredentials = {
        apiKey: follower.apiKey,
        secretKey: follower.secretKey
      };

      // Determine close side (opposite of entry)
      const closeSide: 'BUY' | 'SELL' = position.side === 'BUY' ? 'SELL' : 'BUY';

      // Cancel any existing TP/SL orders first
      if (position.tpOrderId) {
        try {
          await cancelOrder(position.symbol, position.tpOrderId, followerCredentials);
        } catch (error) {
          logWarnWithTimestamp(`Copy Trading: Failed to cancel TP order ${position.tpOrderId}:`, error);
        }
      }

      if (position.slOrderId) {
        try {
          await cancelOrder(position.symbol, position.slOrderId, followerCredentials);
        } catch (error) {
          logWarnWithTimestamp(`Copy Trading: Failed to cancel SL order ${position.slOrderId}:`, error);
        }
      }

      // Place market order to close position
      const closeOrder = await placeOrder({
        symbol: position.symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: position.quantity,
        positionSide: position.positionSide,
        reduceOnly: true
      }, followerCredentials);

      const closePrice = parseFloat(closeOrder.avgPrice || closeOrder.price || '0');

      // Calculate PnL
      const pnl = position.side === 'BUY'
        ? (closePrice - position.entryPrice) * position.quantity
        : (position.entryPrice - closePrice) * position.quantity;

      // Update position in database
      await copyTradingDb.closeFollowerPosition(position.id!, closePrice, pnl);

      logWithTimestamp(`Copy Trading: ${follower.name} - Position closed, PnL: ${pnl.toFixed(2)} USDT`);

      this.emit('followerPositionClosed', {
        positionId: position.id!,
        walletName: follower.name,
        symbol: position.symbol,
        pnl
      });

    } catch (error: any) {
      logErrorWithTimestamp('Copy Trading: Failed to close follower position:', error);

      // Mark position as error
      if (position.id) {
        await copyTradingDb.markPositionError(position.id, error.message || 'Failed to close position');
      }

      await errorLogger.logError(error, 'CopyTradingService.closeFollowerPosition', {
        position
      });

      throw error;
    }
  }

  private async updateFollowerTPSL(
    position: FollowerPosition,
    updateEvent: MasterTPSLUpdateEvent
  ): Promise<void> {
    try {
      // Get follower wallet
      const follower = await copyTradingDb.getFollowerWallet(position.walletId);
      if (!follower) {
        throw new Error(`Follower wallet not found: ${position.walletId}`);
      }

      const followerCredentials = {
        apiKey: follower.apiKey,
        secretKey: follower.secretKey
      };

      // Cancel existing TP/SL orders
      if (position.tpOrderId || position.slOrderId) {
        const ordersToCancel = [position.tpOrderId, position.slOrderId].filter(Boolean) as number[];

        for (const orderId of ordersToCancel) {
          try {
            await cancelOrder(position.symbol, orderId, followerCredentials);
          } catch (error) {
            logWarnWithTimestamp(`Copy Trading: Failed to cancel order ${orderId}:`, error);
          }
        }
      }

      // Place new TP/SL orders if provided
      if (updateEvent.tpPrice || updateEvent.slPrice) {
        const result = await placeStopLossAndTakeProfit(
          position.symbol,
          position.positionSide,
          position.quantity,
          position.entryPrice,
          updateEvent.tpPrice,
          updateEvent.slPrice,
          followerCredentials
        );

        // Update position in database with new order IDs
        await copyTradingDb.updateFollowerPosition(position.id!, {
          tpOrderId: result.tpOrderId,
          slOrderId: result.slOrderId,
          tpPrice: updateEvent.tpPrice,
          slPrice: updateEvent.slPrice
        });

        logWithTimestamp(`Copy Trading: ${follower.name} - TP/SL updated for ${position.symbol}`);
      }

    } catch (error) {
      logErrorWithTimestamp('Copy Trading: Failed to update follower TP/SL:', error);
      await errorLogger.logError(error, 'CopyTradingService.updateFollowerTPSL', {
        position,
        updateEvent
      });
      throw error;
    }
  }

  // ===== Public Management Methods =====

  async getFollowerWallets(): Promise<FollowerWallet[]> {
    return await copyTradingDb.getFollowerWallets();
  }

  async addFollowerWallet(wallet: FollowerWallet): Promise<number> {
    const walletId = await copyTradingDb.addFollowerWallet(wallet);
    logWithTimestamp(`Copy Trading: Added follower wallet "${wallet.name}" (ID: ${walletId})`);

    this.emit('walletAdded', { walletId, name: wallet.name });
    return walletId;
  }

  async updateFollowerWallet(id: number, updates: Partial<FollowerWallet>): Promise<void> {
    await copyTradingDb.updateFollowerWallet(id, updates);
    logWithTimestamp(`Copy Trading: Updated follower wallet ID ${id}`);

    this.emit('walletUpdated', { walletId: id, updates });
  }

  async removeFollowerWallet(id: number): Promise<void> {
    await copyTradingDb.removeFollowerWallet(id);
    logWithTimestamp(`Copy Trading: Removed follower wallet ID ${id}`);

    this.emit('walletRemoved', { walletId: id });
  }

  async getWalletStats(walletId: number) {
    return await copyTradingDb.getWalletStats(walletId);
  }

  async getFollowerPositions(walletId?: number, status?: 'open' | 'closed' | 'error'): Promise<FollowerPosition[]> {
    return await copyTradingDb.getFollowerPositions(walletId, status);
  }
}

export const copyTradingService = new CopyTradingService();
