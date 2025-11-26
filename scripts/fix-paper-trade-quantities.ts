#!/usr/bin/env node

/**
 * Migration script to fix paper trade quantities
 *
 * Problem: Old trades have quantity = margin amount (100 USDT) instead of actual contracts
 * Solution: Recalculate quantity = (margin * leverage) / entry_price
 */

import { db } from '../src/lib/db/database';

interface PaperTrade {
  id: number;
  symbol: string;
  quantity: number;
  entry_price: number;
  margin: number;
  leverage: number;
  status: string;
}

async function fixPaperTradeQuantities() {
  console.log('🔧 Starting paper trade quantity migration...\n');

  try {
    // Initialize database
    await db.initialize();

    // Get all paper trades
    const trades = await db.all<PaperTrade>(
      'SELECT id, symbol, quantity, entry_price, margin, leverage, status FROM paper_trades ORDER BY id'
    );

    console.log(`📊 Found ${trades.length} paper trades to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const trade of trades) {
      const { id, symbol, quantity: oldQuantity, entry_price, margin: oldMargin, leverage } = trade;

      // Skip if missing critical data
      if (!entry_price || entry_price <= 0 || !leverage) {
        console.log(`⚠️  Skipping trade ${id} (${symbol}): Missing data`);
        skippedCount++;
        continue;
      }

      // Detect if this is an old trade with incorrect margin
      // Old trades have margin = notional value instead of 100 USDT
      // If margin > 1000 USDT, it's likely incorrect (should be 100)
      const isOldTrade = oldMargin > 1000;

      // Set correct margin (intended trade size was 100 USDT)
      const correctMargin = isOldTrade ? 100 : oldMargin;

      // Calculate correct quantity: (margin * leverage) / entry_price
      const correctQuantity = (correctMargin * leverage) / entry_price;

      // Round to 8 decimal places (standard for crypto)
      const roundedQuantity = Math.round(correctQuantity * 100000000) / 100000000;

      // Check if update is needed
      const quantityNeedsUpdate = Math.abs(oldQuantity - roundedQuantity) > 0.00000001;
      const marginNeedsUpdate = isOldTrade && Math.abs(oldMargin - correctMargin) > 0.01;

      if (quantityNeedsUpdate || marginNeedsUpdate) {
        try {
          await db.run(
            'UPDATE paper_trades SET quantity = ?, margin = ? WHERE id = ?',
            [roundedQuantity, correctMargin, id]
          );

          if (isOldTrade) {
            console.log(
              `✅ Trade ${id} (${symbol}): ` +
              `qty: ${oldQuantity.toFixed(8)} → ${roundedQuantity.toFixed(8)}, ` +
              `margin: ${oldMargin.toFixed(2)} → ${correctMargin} USDT ` +
              `(${leverage}x @ $${entry_price.toFixed(4)})`
            );
          } else {
            console.log(
              `✅ Trade ${id} (${symbol}): ${oldQuantity.toFixed(8)} → ${roundedQuantity.toFixed(8)} ` +
              `(margin: ${correctMargin} USDT, ${leverage}x @ $${entry_price.toFixed(2)})`
            );
          }
          updatedCount++;
        } catch (error) {
          console.error(`❌ Failed to update trade ${id}:`, error);
          errorCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   Total trades: ${trades.length}`);
    console.log(`   ✅ Updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped (already correct): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    if (updatedCount > 0) {
      console.log('\n✨ Migration completed successfully!');
      console.log('   Paper trade quantities have been corrected.');
    } else {
      console.log('\n✨ No updates needed - all quantities are already correct.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run migration
fixPaperTradeQuantities();
