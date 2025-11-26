'use client';

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, Edit2, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { toast } from 'sonner';

interface FollowerWallet {
  id: number;
  name: string;
  apiKey: string;
  secretKey: string;
  enabled: boolean;
  positionSizeMultiplier: number;
  maxPositionsPerPair: number;
  symbolsFilter?: string[];
}

interface WalletStats {
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
  totalPnL: number;
  winRate: number;
}

export default function CopyTradingPage() {
  const [wallets, setWallets] = useState<FollowerWallet[]>([]);
  const [stats, setStats] = useState<Map<number, WalletStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingWallet, setEditingWallet] = useState<FollowerWallet | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formSecretKey, setFormSecretKey] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formMultiplier, setFormMultiplier] = useState(1.0);
  const [formMaxPositions, setFormMaxPositions] = useState(2);
  const [formSymbolsFilter, setFormSymbolsFilter] = useState('');

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/copy-trading/wallets');
      if (!response.ok) throw new Error('Failed to fetch wallets');

      const walletsData = await response.json();
      setWallets(walletsData);

      // Fetch stats for each wallet
      for (const wallet of walletsData) {
        fetchWalletStats(wallet.id);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  };

  const fetchWalletStats = async (walletId: number) => {
    try {
      const response = await fetch(`/api/copy-trading/stats/${walletId}`);
      if (!response.ok) return;

      const statsData = await response.json();
      setStats(prev => new Map(prev).set(walletId, statsData));
    } catch (error) {
      console.error('Failed to fetch wallet stats:', error);
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormApiKey('');
    setFormSecretKey('');
    setFormEnabled(true);
    setFormMultiplier(1.0);
    setFormMaxPositions(2);
    setFormSymbolsFilter('');
    setEditingWallet(null);
  };

  const handleAddWallet = async () => {
    try {
      const symbolsArray = formSymbolsFilter
        ? formSymbolsFilter.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      const response = await fetch('/api/copy-trading/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          apiKey: formApiKey,
          secretKey: formSecretKey,
          enabled: formEnabled,
          positionSizeMultiplier: formMultiplier,
          maxPositionsPerPair: formMaxPositions,
          symbolsFilter: symbolsArray,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add wallet');
      }

      toast.success('Follower wallet added successfully');
      resetForm();
      setShowAddForm(false);
      fetchWallets();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleUpdateWallet = async (walletId: number) => {
    try {
      const symbolsArray = formSymbolsFilter
        ? formSymbolsFilter.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      const response = await fetch(`/api/copy-trading/wallets/${walletId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          apiKey: formApiKey !== '***' ? formApiKey : undefined,
          secretKey: formSecretKey !== '***' ? formSecretKey : undefined,
          enabled: formEnabled,
          positionSizeMultiplier: formMultiplier,
          maxPositionsPerPair: formMaxPositions,
          symbolsFilter: symbolsArray,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update wallet');
      }

      toast.success('Follower wallet updated successfully');
      resetForm();
      setShowAddForm(false);
      fetchWallets();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteWallet = async (walletId: number, walletName: string) => {
    if (!confirm(`Are you sure you want to delete "${walletName}"? This will also delete all associated positions.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/copy-trading/wallets/${walletId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete wallet');
      }

      toast.success('Follower wallet deleted successfully');
      fetchWallets();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleToggleEnabled = async (wallet: FollowerWallet) => {
    try {
      const response = await fetch(`/api/copy-trading/wallets/${wallet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !wallet.enabled,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to toggle wallet');
      }

      toast.success(`Wallet ${!wallet.enabled ? 'enabled' : 'disabled'}`);
      fetchWallets();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const startEdit = (wallet: FollowerWallet) => {
    setEditingWallet(wallet);
    setFormName(wallet.name);
    setFormApiKey(wallet.apiKey);
    setFormSecretKey(wallet.secretKey);
    setFormEnabled(wallet.enabled);
    setFormMultiplier(wallet.positionSizeMultiplier);
    setFormMaxPositions(wallet.maxPositionsPerPair);
    setFormSymbolsFilter(wallet.symbolsFilter?.join(', ') || '');
    setShowAddForm(true);
  };

  if (loading) {
    return (
      <div className="p-8">
        <p>Loading copy trading wallets...</p>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Copy Trading</h1>
            <p className="text-muted-foreground mt-1">
              Manage follower wallets that copy your master account trades
            </p>
          </div>
        <Button
          onClick={() => {
            resetForm();
            setShowAddForm(!showAddForm);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Follower Wallet
        </Button>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingWallet ? 'Edit' : 'Add'} Follower Wallet</CardTitle>
            <CardDescription>
              Configure a follower wallet to copy trades from your master account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Wallet Name</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Follower Account 1"
                />
              </div>

              <div className="space-y-2">
                <Label>Position Size Multiplier</Label>
                <Input
                  type="number"
                  value={formMultiplier}
                  onChange={(e) => setFormMultiplier(parseFloat(e.target.value))}
                  min="0.1"
                  max="5"
                  step="0.1"
                />
                <p className="text-xs text-muted-foreground">
                  1.0 = 100% of master size, 0.5 = 50%, 2.0 = 200%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder="Enter follower account API key"
                  type="password"
                />
              </div>

              <div className="space-y-2">
                <Label>Secret Key</Label>
                <Input
                  value={formSecretKey}
                  onChange={(e) => setFormSecretKey(e.target.value)}
                  placeholder="Enter follower account secret key"
                  type="password"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max Positions Per Pair</Label>
                <Input
                  type="number"
                  value={formMaxPositions}
                  onChange={(e) => setFormMaxPositions(parseInt(e.target.value))}
                  min="1"
                  max="20"
                />
              </div>

              <div className="space-y-2 flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={formEnabled}
                  onCheckedChange={setFormEnabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Symbol Filter (Optional)</Label>
              <Input
                value={formSymbolsFilter}
                onChange={(e) => setFormSymbolsFilter(e.target.value)}
                placeholder="e.g., BTCUSDT, ETHUSDT (leave empty to copy all symbols)"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of symbols to copy. Leave empty to copy all.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setShowAddForm(false);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => editingWallet ? handleUpdateWallet(editingWallet.id) : handleAddWallet()}
                disabled={!formName || !formApiKey || !formSecretKey}
              >
                {editingWallet ? 'Update' : 'Add'} Wallet
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wallets List */}
      <div className="grid gap-4">
        {wallets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No follower wallets configured</p>
              <p className="text-sm mt-2">Add a follower wallet to start copy trading</p>
            </CardContent>
          </Card>
        ) : (
          wallets.map((wallet) => {
            const walletStats = stats.get(wallet.id);

            return (
              <Card key={wallet.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle>{wallet.name}</CardTitle>
                      <Badge variant={wallet.enabled ? 'default' : 'secondary'}>
                        {wallet.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(wallet)}
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleEnabled(wallet)}
                      >
                        {wallet.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteWallet(wallet.id, wallet.name)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Position Size</p>
                      <p className="text-lg font-semibold">{(wallet.positionSizeMultiplier * 100).toFixed(0)}%</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Max Positions/Pair</p>
                      <p className="text-lg font-semibold">{wallet.maxPositionsPerPair}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Symbol Filter</p>
                      <p className="text-sm font-medium">
                        {wallet.symbolsFilter && wallet.symbolsFilter.length > 0
                          ? wallet.symbolsFilter.join(', ')
                          : 'All symbols'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">API Keys</p>
                      <p className="text-sm">Configured</p>
                    </div>
                  </div>

                  {walletStats && (
                    <>
                      <Separator className="my-4" />
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Total Trades</p>
                          <p className="text-lg font-semibold">{walletStats.totalTrades}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Open Positions</p>
                          <p className="text-lg font-semibold">{walletStats.openPositions}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Closed Positions</p>
                          <p className="text-lg font-semibold">{walletStats.closedPositions}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Total PnL</p>
                          <p className={`text-lg font-semibold flex items-center gap-1 ${walletStats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {walletStats.totalPnL >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            ${walletStats.totalPnL.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Win Rate</p>
                          <p className="text-lg font-semibold">{walletStats.winRate.toFixed(1)}%</p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      </div>
    </DashboardLayout>
  );
}
