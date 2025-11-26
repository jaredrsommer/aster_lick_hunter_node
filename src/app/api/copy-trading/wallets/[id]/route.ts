import { NextRequest, NextResponse } from 'next/server';
import { copyTradingService } from '@/lib/services/copyTradingService';
import { withAuth } from '@/lib/auth/with-auth';

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

  if (req.method === 'PUT') {
    // Update a follower wallet
    try {
      const body = await req.json();

      // Build updates object (only include provided fields)
      const updates: any = {};

      if (body.name !== undefined) updates.name = body.name;
      if (body.apiKey !== undefined && body.apiKey !== '***') updates.apiKey = body.apiKey;
      if (body.secretKey !== undefined && body.secretKey !== '***') updates.secretKey = body.secretKey;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.positionSizeMultiplier !== undefined) updates.positionSizeMultiplier = body.positionSizeMultiplier;
      if (body.maxPositionsPerPair !== undefined) updates.maxPositionsPerPair = body.maxPositionsPerPair;
      if (body.symbolsFilter !== undefined) updates.symbolsFilter = body.symbolsFilter;

      await copyTradingService.updateFollowerWallet(walletId, updates);

      return NextResponse.json({
        success: true,
        message: 'Follower wallet updated successfully'
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Failed to update wallet' },
        { status: 500 }
      );
    }
  }

  if (req.method === 'DELETE') {
    // Delete a follower wallet
    try {
      await copyTradingService.removeFollowerWallet(walletId);

      return NextResponse.json({
        success: true,
        message: 'Follower wallet deleted successfully'
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Failed to delete wallet' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}

export const PUT = withAuth(handler);
export const DELETE = withAuth(handler);
