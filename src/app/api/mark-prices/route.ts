import { NextResponse } from 'next/server';
import { getMarkPrice } from '@/lib/api/market';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const markPrices = await getMarkPrice();
    return NextResponse.json(markPrices);
  } catch (error) {
    console.error('[Mark Prices API] Error fetching mark prices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mark prices' },
      { status: 500 }
    );
  }
}
