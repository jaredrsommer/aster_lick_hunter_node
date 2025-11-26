'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LiquidationChart from '@/components/LiquidationChart';
import { TrendingDown, TrendingUp, DollarSign, Activity } from 'lucide-react';
import { useConfig } from '@/components/ConfigProvider';

const INTERVALS = [
  { value: '1m', label: '1 Minute' },
  { value: '5m', label: '5 Minutes' },
  { value: '15m', label: '15 Minutes' },
  { value: '30m', label: '30 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
  { value: '1d', label: '1 Day' },
];

export default function LiquidationsPage() {
  const { config } = useConfig();
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [selectedInterval, setSelectedInterval] = useState<string>('5m');
  const [stats, setStats] = useState({
    totalLiquidations: 0,
    totalVolume: 0,
    longLiquidations: 0,
    shortLiquidations: 0,
    longVolume: 0,
    shortVolume: 0,
  });

  // Get available symbols from config
  const symbols = config?.symbols ? Object.keys(config.symbols) : ['BTCUSDT'];

  // Fetch statistics for the selected symbol
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/liquidations?symbol=${selectedSymbol}&interval=${selectedInterval}&limit=500`);
        if (!response.ok) return;

        const data = await response.json();

        // Calculate statistics
        const longLiqs = data.liquidations.filter((l: any) => l.side === 'BUY');
        const shortLiqs = data.liquidations.filter((l: any) => l.side === 'SELL');

        const longVol = longLiqs.reduce((sum: number, l: any) => sum + l.volumeUSDT, 0);
        const shortVol = shortLiqs.reduce((sum: number, l: any) => sum + l.volumeUSDT, 0);

        setStats({
          totalLiquidations: data.liquidations.length,
          totalVolume: longVol + shortVol,
          longLiquidations: longLiqs.length,
          shortLiquidations: shortLiqs.length,
          longVolume: longVol,
          shortVolume: shortVol,
        });
      } catch (error) {
        console.error('Failed to fetch liquidation stats:', error);
      }
    };

    fetchStats();
  }, [selectedSymbol, selectedInterval]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Liquidation Heatmap</h1>
            <p className="text-muted-foreground mt-1">
              Visualize liquidation events with volume-weighted bubbles
            </p>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="space-y-4">
          {/* Top Row - Total Stats */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Total Liquidations</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalLiquidations}</p>
              </div>
            </Card>

            <Card className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Total Volume</span>
                </div>
                <p className="text-2xl font-bold">${(stats.totalVolume / 1000).toFixed(1)}K</p>
              </div>
            </Card>
          </div>

          {/* Balance of Power Bar */}
          <Card className="p-3">
            <div className="text-sm font-medium mb-1">Balance of Power</div>
            <div className="space-y-1">
              {/* Gradient Bar */}
              <div className="relative h-10 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800/50">
                {/* Background gradient with transparency */}
                <div className="absolute inset-0 flex">
                  <div
                    className="bg-gradient-to-r from-red-500/80 via-red-400/70 to-transparent flex items-center justify-start px-3"
                    style={{ width: `${stats.totalVolume > 0 ? (stats.longVolume / stats.totalVolume) * 100 : 50}%` }}
                  >
                    <div className="flex items-center gap-1.5 text-white text-xs font-semibold">
                      <TrendingDown className="w-3.5 h-3.5" />
                      <span>{stats.longLiquidations}</span>
                    </div>
                  </div>
                  <div
                    className="bg-gradient-to-l from-green-500/80 via-green-400/70 to-transparent flex items-center justify-end px-3"
                    style={{ width: `${stats.totalVolume > 0 ? (stats.shortVolume / stats.totalVolume) * 100 : 50}%` }}
                  >
                    <div className="flex items-center gap-1.5 text-white text-xs font-semibold">
                      <span>{stats.shortLiquidations}</span>
                      <TrendingUp className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>

                {/* Center indicator ball */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white dark:bg-gray-900 rounded-full border-3 border-gray-400 dark:border-gray-500 shadow-lg transition-all duration-300"
                  style={{
                    left: `calc(${stats.totalVolume > 0 ? (stats.longVolume / stats.totalVolume) * 100 : 50}% - 0.75rem)`,
                  }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-gray-600 dark:bg-gray-300 rounded-full" />
                  </div>
                </div>
              </div>

              {/* Volume Stats Below Bar */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-muted-foreground">
                    ${(stats.longVolume / 1000).toFixed(1)}K
                    <span className="ml-1.5 opacity-70">
                      ({stats.totalVolume > 0 ? ((stats.longVolume / stats.totalVolume) * 100).toFixed(1) : 50}%)
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">
                    <span className="mr-1.5 opacity-70">
                      ({stats.totalVolume > 0 ? ((stats.shortVolume / stats.totalVolume) * 100).toFixed(1) : 50}%)
                    </span>
                    ${(stats.shortVolume / 1000).toFixed(1)}K
                  </span>
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Chart */}
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              {/* Symbol dropdown - left side */}
              <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select symbol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BTCUSDT">BTCUSDT</SelectItem>
                  <SelectItem value="ETHUSDT">ETHUSDT</SelectItem>
                  <SelectItem value="SOLUSDT">SOLUSDT</SelectItem>
                </SelectContent>
              </Select>

              {/* Timeframe dropdown - right side */}
              <Select value={selectedInterval} onValueChange={setSelectedInterval}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">1m</SelectItem>
                  <SelectItem value="5m">5m</SelectItem>
                  <SelectItem value="15m">15m</SelectItem>
                  <SelectItem value="30m">30m</SelectItem>
                  <SelectItem value="1h">1h</SelectItem>
                  <SelectItem value="4h">4h</SelectItem>
                  <SelectItem value="1d">1d</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full h-[600px]">
              <LiquidationChart symbol={selectedSymbol} interval={selectedInterval} />
            </div>
          </CardContent>
        </Card>

        {/* How to Read Section - Below Chart */}
        <Card>
          <CardHeader>
            <CardTitle>How to Read the Chart</CardTitle>
            <CardDescription>Understanding the liquidation heatmap</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500/50 border-2 border-red-500 mt-1 flex-shrink-0" />
              <p className="text-sm">
                <strong>Red bubbles</strong> = Long positions liquidated (forced sells)
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500/50 border-2 border-green-500 mt-1 flex-shrink-0" />
              <p className="text-sm">
                <strong>Green bubbles</strong> = Short positions liquidated (forced buys)
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-4 h-4 rounded-full bg-muted border-2 border-border mt-1 flex-shrink-0" />
              <p className="text-sm">
                <strong>Bubble size</strong> = Liquidation volume in USDT
              </p>
            </div>
            <div className="mt-4 p-3 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">
                <strong>Trading Strategy:</strong> Large liquidation clusters often indicate price levels with high leverage.
                The bot enters contrarian positions when liquidations exceed configured thresholds.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
