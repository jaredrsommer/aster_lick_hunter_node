import { NextRequest, NextResponse } from 'next/server';
import { paperTradeDb } from '@/lib/db/paperTradeDb';
import { withAuth } from '@/lib/auth/with-auth';

async function handler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || undefined;
  const status = searchParams.get('status') as 'open' | 'closed' | undefined;
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0;

  try {
    const trades = await paperTradeDb.getTrades({
      symbol,
      status,
      limit,
      offset,
    });

    return NextResponse.json(trades);
  } catch (error: any) {
    console.error('Error fetching paper trades:', error);
    return NextResponse.json(
      { error: 'Failed to fetch paper trades', message: error.message },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
