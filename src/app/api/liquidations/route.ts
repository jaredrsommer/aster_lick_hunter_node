import { NextRequest, NextResponse } from 'next/server';
import { liquidationStorage } from '@/lib/services/liquidationStorage';
import axios from 'axios';

const BASE_URL = 'https://fapi.asterdex.com';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface LiquidationMarker {
  time: number;
  price: number;
  side: 'BUY' | 'SELL';
  volumeUSDT: number;
  quantity: number;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const interval = searchParams.get('interval') || '5m'; // 1m, 5m, 15m, 30m, 1h, 4h, 1d
    const limit = parseInt(searchParams.get('limit') || '500');

    // Calculate time range based on interval
    const now = Date.now();
    const intervalMs: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    const timeWindowMs = (intervalMs[interval] || intervalMs['5m']) * limit;
    const startTime = now - timeWindowMs;

    // Fetch candle data from exchange
    let candleData: CandleData[] = [];
    try {
      const klineResponse = await axios.get(`${BASE_URL}/fapi/v1/klines`, {
        params: {
          symbol,
          interval,
          limit,
          startTime,
        },
        timeout: 10000,
      });

      candleData = klineResponse.data
        .map((candle: any) => ({
          time: Math.floor(candle[0] / 1000), // Convert to seconds
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5]),
        }))
        .filter((candle: CandleData) =>
          !isNaN(candle.time) &&
          !isNaN(candle.open) &&
          !isNaN(candle.high) &&
          !isNaN(candle.low) &&
          !isNaN(candle.close) &&
          candle.time > 0
        )
        .sort((a: CandleData, b: CandleData) => a.time - b.time);
    } catch (error) {
      console.error('Failed to fetch candle data:', error);
      // Continue without candle data
    }

    // Fetch liquidations from database
    // Note: event_time in database is stored in milliseconds
    const { liquidations } = await liquidationStorage.getLiquidations({
      symbol,
      from: startTime, // Keep in milliseconds
      to: now,         // Keep in milliseconds
      limit: 1000, // Get all liquidations in range
    });

    // Transform liquidations to markers
    const liquidationMarkers: LiquidationMarker[] = liquidations.map((liq) => ({
      time: Math.floor(liq.event_time / 1000), // Convert to seconds
      price: liq.average_price,
      side: liq.side,
      volumeUSDT: liq.volume_usdt,
      quantity: liq.quantity,
    }));

    // Group liquidations by time and price to create aggregated markers
    const aggregatedMarkers = new Map<string, LiquidationMarker>();
    liquidationMarkers.forEach((marker) => {
      // Round time to nearest candle interval
      const candleTime = Math.floor(marker.time / (intervalMs[interval] / 1000)) * (intervalMs[interval] / 1000);
      // Round price to 2 decimal places for grouping
      const roundedPrice = Math.round(marker.price * 100) / 100;
      const key = `${candleTime}_${marker.side}_${roundedPrice}`;

      if (aggregatedMarkers.has(key)) {
        const existing = aggregatedMarkers.get(key)!;
        existing.volumeUSDT += marker.volumeUSDT;
        existing.quantity += marker.quantity;
      } else {
        aggregatedMarkers.set(key, {
          time: candleTime,
          price: roundedPrice,
          side: marker.side,
          volumeUSDT: marker.volumeUSDT,
          quantity: marker.quantity,
        });
      }
    });

    return NextResponse.json({
      success: true,
      symbol,
      interval,
      candles: candleData,
      liquidations: Array.from(aggregatedMarkers.values()).sort((a, b) => a.time - b.time),
      totalLiquidations: liquidations.length,
    });
  } catch (error) {
    console.error('Error in liquidations API:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch liquidation data' },
      { status: 500 }
    );
  }
}
