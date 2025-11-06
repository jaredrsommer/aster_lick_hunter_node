import { NextRequest, NextResponse } from 'next/server';
import { copyTradingService } from '@/lib/services/copyTradingService';
import { withAuth } from '@/lib/auth/api-auth';

async function handler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const walletId = searchParams.get('walletId');
    const status = searchParams.get('status') as 'open' | 'closed' | 'error' | null;

    const positions = await copyTradingService.getFollowerPositions(
      walletId ? parseInt(walletId) : undefined,
      status || undefined
    );

    return NextResponse.json(positions);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch positions' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
