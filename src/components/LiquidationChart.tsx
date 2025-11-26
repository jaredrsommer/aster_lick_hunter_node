'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickData, Time } from 'lightweight-charts';

interface Liquidation {
  time: number;
  price: number;
  volumeUSDT: number;
  side: 'BUY' | 'SELL';
}

interface LiquidationChartProps {
  symbol: string;
  interval: string;
}

export default function LiquidationChart({ symbol, interval }: LiquidationChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const liquidationMarkersRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart: any = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2B2B43',
      },
      rightPriceScale: {
        borderColor: '#2B2B43',
      },
      crosshair: {
        mode: 1,
      },
    });

    chartRef.current = chart;

    // Create candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Handle window resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Fetch and update data when symbol or interval changes
  useEffect(() => {
    let isInitialLoad = true;
    let refreshInterval: NodeJS.Timeout;

    const fetchData = async () => {
      if (!chartRef.current || !candlestickSeriesRef.current) return;

      // Only show loading on initial load
      if (isInitialLoad) {
        setLoading(true);
        setError(null);
      }

      try {
        const response = await fetch(`/api/liquidations?symbol=${symbol}&interval=${interval}&limit=500`);
        if (!response.ok) throw new Error('Failed to fetch liquidation data');

        const data = await response.json();

        if (isInitialLoad) {
          console.log('[LiquidationChart] Initial load:', {
            candles: data.candles?.length || 0,
            liquidations: data.liquidations?.length || 0,
          });
        }

        // Set candlestick data
        const candleData: CandlestickData<Time>[] = data.candles
          .filter((candle: any) => candle.time && !isNaN(candle.time))
          .map((candle: any) => ({
            time: candle.time as Time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }));

        if (candleData.length === 0) {
          throw new Error('No valid candle data received');
        }

        // Use setData for initial load, update doesn't work well for full refresh
        candlestickSeriesRef.current.setData(candleData);

        // Clear previous liquidation markers
        liquidationMarkersRef.current.forEach(marker => marker.remove());
        liquidationMarkersRef.current = [];

        // Add liquidation bubbles
        if (chartContainerRef.current && data.liquidations && data.liquidations.length > 0) {
          if (isInitialLoad) {
            console.log('[LiquidationChart] Adding', data.liquidations.length, 'liquidation bubbles');
          }
          data.liquidations.forEach((liq: Liquidation) => {
            addLiquidationBubble(liq);
          });
        }

        // Fit content only on initial load
        if (isInitialLoad) {
          chartRef.current.timeScale().fitContent();
          setLoading(false);
          isInitialLoad = false;
        }
      } catch (err) {
        console.error('Error fetching liquidation data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    // Initial fetch
    fetchData();

    // Set up auto-refresh every 30 seconds
    refreshInterval = setInterval(() => {
      fetchData();
    }, 30000);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [symbol, interval]);

  const addLiquidationBubble = (liquidation: Liquidation) => {
    if (!chartContainerRef.current || !chartRef.current || !candlestickSeriesRef.current) {
      return;
    }

    // Calculate bubble size based on volume (min 10px, max 50px)
    const minSize = 10;
    const maxSize = 50;
    const size = Math.min(maxSize, Math.max(minSize, Math.sqrt(liquidation.volumeUSDT) / 10));

    // Create bubble element
    const bubble = document.createElement('div');
    bubble.style.position = 'absolute';
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.borderRadius = '50%';
    bubble.style.backgroundColor = liquidation.side === 'BUY' ? 'rgba(239, 83, 80, 0.5)' : 'rgba(38, 166, 154, 0.5)';
    bubble.style.border = `2px solid ${liquidation.side === 'BUY' ? '#ef5350' : '#26a69a'}`;
    bubble.style.pointerEvents = 'auto';
    bubble.style.cursor = 'pointer';
    bubble.style.zIndex = '10';
    bubble.style.transition = 'transform 0.2s';

    // Tooltip
    bubble.title = `${liquidation.side === 'BUY' ? 'Long' : 'Short'} Liquidation\n$${liquidation.volumeUSDT.toFixed(2)}\nPrice: ${liquidation.price.toFixed(4)}`;

    // Hover effect
    bubble.addEventListener('mouseenter', () => {
      bubble.style.transform = 'scale(1.2)';
    });

    bubble.addEventListener('mouseleave', () => {
      bubble.style.transform = 'scale(1)';
    });

    // Position bubble on chart
    const updateBubblePosition = () => {
      if (!chartRef.current || !candlestickSeriesRef.current) return;

      try {
        const timeScale = chartRef.current.timeScale();
        const timeCoordinate = timeScale.timeToCoordinate(liquidation.time as Time);

        // Use series.priceToCoordinate for v4 API
        const priceCoordinate = candlestickSeriesRef.current.priceToCoordinate(liquidation.price);

        if (timeCoordinate !== null && priceCoordinate !== null) {
          bubble.style.left = `${timeCoordinate - size / 2}px`;
          bubble.style.top = `${priceCoordinate - size / 2}px`;
          bubble.style.display = 'block';
        } else {
          bubble.style.display = 'none';
        }
      } catch (error) {
        // Silently fail - coordinate conversion errors are common during updates
        bubble.style.display = 'none';
      }
    };

    // Subscribe to visible range changes
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(updateBubblePosition);

    // Initial position
    updateBubblePosition();

    // Add to container
    chartContainerRef.current.appendChild(bubble);
    liquidationMarkersRef.current.push(bubble);
  };

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <p className="text-muted-foreground">Loading liquidation data...</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <p className="text-red-500">Error: {error}</p>
        </div>
      )}
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
