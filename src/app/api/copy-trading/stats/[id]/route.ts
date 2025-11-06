import { NextRequest, NextResponse } from 'next/server';
import { copyTradingService } from '@/lib/services/copyTradingService';
import { withAuth } from '@/lib/auth/api-auth';

async function handler(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const walletId = parseInt(params.id);

  if (isNaN(walletId)) {
    return NextResponse.json(
      { error: 'Invalid wallet ID' },
      { status: 400 }
    );
  }

  try {
    const stats = await copyTradingService.getWalletStats(walletId);
    return NextResponse.json(stats);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
