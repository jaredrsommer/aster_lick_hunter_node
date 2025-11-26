import { NextRequest, NextResponse } from 'next/server';
import { getBalance, getAccountInfo } from '@/lib/api/market';
import { loadConfig } from '@/lib/bot/config';
import { getBalanceService } from '@/lib/services/balanceService';
import { withAuth } from '@/lib/auth/with-auth';
import { getRateLimitManager, RequestPriority } from '@/lib/api/rateLimitManager';

// Simple in-memory cache
interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_TTL = 5000; // 5 seconds

export const GET = withAuth(async (request: NextRequest, _user) => {
  const startTime = Date.now();
  const cacheKey = 'balance';

  // Check if force refresh is requested
  const searchParams = request.nextUrl.searchParams;
  const forceRefresh = searchParams.get('force') === 'true';

  // Check cache first (skip if force refresh)
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        ...cached.data,
        cached: true,
        responseTime: Date.now() - startTime,
      });
    }
  }

  try {
    const config = await loadConfig();

    // If in paper mode, calculate balance from paper trades
    if (config.global.paperMode) {
      try {
        const { paperTradeDb } = await import('@/lib/db/paperTradeDb');
        const { db } = await import('@/lib/db/database');

        // Get starting balance and realized P&L from balance state
        let startingBalance = 10000;
        let realizedPnL = 0;

        try {
          const balanceState = await db.get<{
            starting_balance: number;
            realized_pnl: number;
          }>('SELECT * FROM paper_balance_state WHERE id = 1');

          if (balanceState) {
            startingBalance = balanceState.starting_balance;
            realizedPnL = balanceState.realized_pnl;
          }
        } catch (err) {
          // Table might not exist yet
        }

        // Get open trades to calculate used margin and unrealized P&L
        const openTrades = await paperTradeDb.getTrades({ status: 'open' });

        let usedMargin = 0;
        let unrealizedPnL = 0;

        for (const trade of openTrades) {
          usedMargin += trade.margin;
          unrealizedPnL += trade.pnl || 0;
        }

        // Total balance = starting balance + realized P&L
        const totalBalance = startingBalance + realizedPnL;

        // Available balance = total balance - used margin
        const availableBalance = totalBalance - usedMargin;

        return NextResponse.json({
          totalBalance,
          availableBalance,
          totalPositionValue: usedMargin,
          totalPnL: unrealizedPnL,
          source: 'paper',
          timestamp: Date.now(),
          responseTime: Date.now() - startTime,
        });
      } catch (error: any) {
        console.error('[Balance API] Error calculating paper balance:', error);
        // Fall through to mock data
      }
    }

    // If no API key is configured, return mock data
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json({
        totalBalance: 10000,
        availableBalance: 8500,
        totalPositionValue: 1500,
        totalPnL: 60,
        source: 'mock',
        timestamp: Date.now(),
      });
    }

    // Try to use WebSocket balance service first (real-time data)
    const balanceService = getBalanceService();

    if (balanceService) {
      const _status = balanceService.getConnectionStatus();

      if (balanceService.isInitialized()) {
        const balanceData = balanceService.getCurrentBalance();

        // Check if data is stale (more than 5 minutes old)
        const isStale = balanceData.lastUpdate && (Date.now() - balanceData.lastUpdate) > 5 * 60 * 1000;

        if (!isStale && (balanceData.totalBalance > 0 || balanceData.availableBalance > 0)) {
          const response = {
            totalBalance: balanceData.totalBalance,
            availableBalance: balanceData.availableBalance,
            totalPositionValue: balanceData.totalPositionValue,
            totalPnL: balanceData.totalPnL,
            source: 'websocket',
            timestamp: balanceData.lastUpdate,
          };

          // Cache the WebSocket data
          cache.set(cacheKey, {
            data: response,
            timestamp: Date.now(),
          });

          return NextResponse.json({
            ...response,
            responseTime: Date.now() - startTime,
          });
        } else {
        }
      }
    } else {
    }

    // Check rate limit before making REST API call
    const rateLimitManager = getRateLimitManager();
    const canMakeRequest = rateLimitManager.canMakeRequest(5, false, RequestPriority.MEDIUM);

    if (!canMakeRequest) {
      // Return cached data if available when rate limited
      const cached = cache.get(cacheKey);
      if (cached) {
        return NextResponse.json({
          ...cached.data,
          cached: true,
          rateLimited: true,
          responseTime: Date.now() - startTime,
        });
      }
    }

    // Fallback to REST API if WebSocket service is not available or data is stale
    try {
      const accountData = await getAccountInfo(config.api);

      if (accountData) {
        // Use pre-calculated USDT-equivalent totals from account endpoint
        const availableBalance = parseFloat(accountData.availableBalance || '0');
        const totalPnL = parseFloat(accountData.totalUnrealizedProfit || '0');
        const totalPositionMargin = parseFloat(accountData.totalPositionInitialMargin || '0');

        // Total balance = margin used in positions + available balance
        // This represents your total trading equity/buying power
        const totalBalance = totalPositionMargin + availableBalance;


        const response = {
          totalBalance,
          availableBalance,
          totalPositionValue: totalPositionMargin,
          totalPnL,
          source: 'rest-account',
          timestamp: Date.now(),
        };

        // Cache the successful response
        cache.set(cacheKey, {
          data: response,
          timestamp: Date.now(),
        });

        return NextResponse.json({
          ...response,
          responseTime: Date.now() - startTime,
        });
      }
    } catch (_accountError) {
    }

    // Final fallback to balance API
    const balanceData = await getBalance(config.api);

    let totalBalance = 0;
    let availableBalance = 0;
    let totalPositionValue = 0;
    let totalPnL = 0;

    if (balanceData && Array.isArray(balanceData)) {
      const usdtAsset = balanceData.find((a: any) => a.asset === 'USDT');
      if (usdtAsset) {
        // balance is the wallet balance
        totalBalance = parseFloat(usdtAsset.balance || '0');
        // availableBalance is free balance for trading
        availableBalance = parseFloat(usdtAsset.availableBalance || '0');
        // crossUnPnl is unrealized PnL
        totalPnL = parseFloat(usdtAsset.crossUnPnl || '0');
        // Position value should be the margin used (total - available)
        totalPositionValue = Math.max(0, totalBalance - availableBalance);

      } else {
      }
    } else {
    }

    const response = {
      totalBalance,
      availableBalance,
      totalPositionValue,
      totalPnL,
      source: 'rest-balance',
      timestamp: Date.now(),
    };

    // Cache the successful response
    cache.set(cacheKey, {
      data: response,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      ...response,
      responseTime: Date.now() - startTime,
    });
  } catch (error: any) {

    // Return error response with details
    return NextResponse.json({
      totalBalance: 0,
      availableBalance: 0,
      totalPositionValue: 0,
      totalPnL: 0,
      source: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
      responseTime: Date.now() - startTime,
    }, { status: 500 });
  }
});