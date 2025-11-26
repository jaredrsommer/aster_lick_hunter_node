'use client';

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface TickerItem {
  symbol: string;
  price: number;
  change24h: number;
}

interface SymbolTickerProps {
  symbols: string[];
  markPrices: Record<string, number>;
}

export default function SymbolTicker({ symbols, markPrices }: SymbolTickerProps) {
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [fallbackPrices, setFallbackPrices] = useState<Record<string, number>>({});

  // Fetch mark prices from API as fallback when WebSocket doesn't have them
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await fetch('/api/mark-prices');
        if (response.ok) {
          const data = await response.json();
          const prices: Record<string, number> = {};
          data.forEach((item: any) => {
            prices[item.symbol] = parseFloat(item.markPrice);
          });
          setFallbackPrices(prices);
        }
      } catch (error) {
        console.error('[SymbolTicker] Failed to fetch mark prices:', error);
      }
    };

    // Only fetch if we don't have WebSocket prices
    const hasWebSocketPrices = symbols.some(symbol => markPrices[symbol] > 0);

    if (!hasWebSocketPrices) {
      // Initial fetch
      fetchPrices();

      // Poll every 30 seconds as fallback (only when WebSocket is down)
      const interval = setInterval(fetchPrices, 30000);

      return () => clearInterval(interval);
    }
  }, [symbols, markPrices]);

  useEffect(() => {
    // Create ticker items with price and mock 24h change
    // Prefer WebSocket prices, fallback to API prices
    const items: TickerItem[] = symbols.map(symbol => ({
      symbol,
      price: markPrices[symbol] || fallbackPrices[symbol] || 0,
      change24h: (Math.random() - 0.5) * 10, // Mock change for now
    }));
    setTickerItems(items);
  }, [symbols, markPrices, fallbackPrices]);

  // Duplicate items for seamless loop
  const duplicatedItems = [...tickerItems, ...tickerItems];

  // Don't render if no items or all prices are 0
  if (tickerItems.length === 0 || tickerItems.every(item => item.price === 0)) {
    return null;
  }

  return (
    <div className="relative w-3/4 mx-auto overflow-hidden bg-muted/30 rounded-md py-1.5">
      <div className="flex animate-ticker group">
        {duplicatedItems.map((item, index) => (
          <div
            key={`${item.symbol}-${index}`}
            className="flex items-center gap-2 px-4 whitespace-nowrap flex-shrink-0"
          >
            {/* Symbol */}
            <span className="text-xs font-semibold text-foreground">
              {item.symbol.replace('USDT', '')}
            </span>

            {/* Price */}
            <span className="text-xs text-muted-foreground">
              ${item.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6,
              })}
            </span>

            {/* 24h Change */}
            <div
              className={`flex items-center gap-0.5 text-xs ${
                item.change24h >= 0 ? 'text-green-500' : 'text-red-500'
              }`}
            >
              {item.change24h >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              <span className="font-medium">
                {Math.abs(item.change24h).toFixed(2)}%
              </span>
            </div>

            {/* Separator */}
            <div className="w-px h-4 bg-border ml-2" />
          </div>
        ))}
      </div>

      {/* Gradient fade on edges */}
      <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none" />
    </div>
  );
}
