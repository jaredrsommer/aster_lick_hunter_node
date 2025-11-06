import { NextRequest, NextResponse } from 'next/server';
import { copyTradingService } from '@/lib/services/copyTradingService';
import { withAuth } from '@/lib/auth/api-auth';

async function handler(req: NextRequest) {
  if (req.method === 'GET') {
    // Get all follower wallets
    try {
      const wallets = await copyTradingService.getFollowerWallets();

      // Don't send API keys/secrets to frontend for security
      const sanitizedWallets = wallets.map(wallet => ({
        ...wallet,
        apiKey: wallet.apiKey ? '***' : '',
        secretKey: wallet.secretKey ? '***' : '',
      }));

      return NextResponse.json(sanitizedWallets);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Failed to fetch wallets' },
        { status: 500 }
      );
    }
  }

  if (req.method === 'POST') {
    // Add a new follower wallet
    try {
      const body = await req.json();

      // Validate required fields
      if (!body.name || !body.apiKey || !body.secretKey) {
        return NextResponse.json(
          { error: 'Missing required fields: name, apiKey, secretKey' },
          { status: 400 }
        );
      }

      const walletId = await copyTradingService.addFollowerWallet({
        name: body.name,
        apiKey: body.apiKey,
        secretKey: body.secretKey,
        enabled: body.enabled ?? true,
        positionSizeMultiplier: body.positionSizeMultiplier ?? 1.0,
        maxPositionsPerPair: body.maxPositionsPerPair ?? 2,
        symbolsFilter: body.symbolsFilter,
      });

      return NextResponse.json({
        success: true,
        walletId,
        message: 'Follower wallet added successfully'
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Failed to add wallet' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}

export const GET = withAuth(handler);
export const POST = withAuth(handler);
