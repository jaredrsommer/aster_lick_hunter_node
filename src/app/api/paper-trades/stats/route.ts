import { NextRequest, NextResponse } from 'next/server';
import { paperTradeDb } from '@/lib/db/paperTradeDb';
import { withAuth } from '@/lib/auth/with-auth';

async function handler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || undefined;
  const startDate = searchParams.get('startDate') ? parseInt(searchParams.get('startDate')!) : undefined;
  const endDate = searchParams.get('endDate') ? parseInt(searchParams.get('endDate')!) : undefined;

  try {
    const stats = await paperTradeDb.getStats({
      symbol,
      startDate,
      endDate,
    });

    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('Error fetching paper trade stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch paper trade stats', message: error.message },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler);
