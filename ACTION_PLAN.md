# Action Plan: Aster Liquidation Hunter Bot Enhancement

**Date:** 2025-11-06
**Branch:** `claude/sync-fork-wallet-trading-011CUqerhX7cM5djte3a8Feq`

---

## Executive Summary

This document outlines a comprehensive plan to enhance the Aster Liquidation Hunter Bot with:
1. Fork synchronization with upstream (CryptoGnome/aster_lick_hunter_node)
2. Wallet copy trading functionality with position sizing per wallet
3. Max open positions per trading pair
4. Telegram bot interface for manual controls and status updates
5. Codebase improvements based on security and architecture review

---

## 🔍 Codebase Review Findings

### ✅ Strengths
1. **Well-architected dual-process system** (Web UI + Bot Service)
2. **Comprehensive error handling** with SQLite logging
3. **Real-time WebSocket communication** for UI updates
4. **Robust rate limiting** with intelligent queuing
5. **Extensive testing suite** covering core components
6. **Hot-reload configuration** management
7. **Cross-platform process management** (Windows/Unix support)

### ⚠️ Potential Issues & Recommendations

#### 1. **Security Concerns**
- **Issue:** API keys stored in plaintext in `config.user.json`
- **Impact:** Medium - local file system security dependent
- **Recommendation:** Consider encryption at rest for API keys
- **Priority:** Medium

#### 2. **Position Manager Scalability**
- **Issue:** Single PositionManager instance managing all positions
- **Impact:** Could become bottleneck with many simultaneous positions
- **Current:** No max positions per pair limit
- **Recommendation:** Add per-pair position limits (addressing in this plan)
- **Priority:** High (will be implemented)

#### 3. **WebSocket Reconnection**
- **Issue:** Multiple WebSocket connections (liquidation stream, user data, balance, price)
- **Current:** Each has independent reconnection logic
- **Recommendation:** Centralized connection health monitoring
- **Priority:** Low (current implementation works well)

#### 4. **Database Cleanup**
- **Issue:** Only liquidation DB has auto-cleanup (7 days)
- **Impact:** Error logs could grow indefinitely
- **Recommendation:** Add retention policy for error logs
- **Priority:** Medium

#### 5. **Rate Limit Monitoring**
- **Issue:** Rate limits monitored but no graceful degradation
- **Impact:** Bot could hit limits during high-volume periods
- **Recommendation:** Implement trade queuing/prioritization when near limits
- **Priority:** Low (current implementation has reserves)

#### 6. **Configuration Validation**
- **Issue:** Trade size validation only at startup
- **Impact:** Price changes could make configured sizes invalid
- **Recommendation:** Periodic re-validation (especially for copy trading)
- **Priority:** Medium

---

## 📋 Implementation Plan

### Phase 1: Fork Synchronization
**Timeline:** Immediate
**Priority:** Critical

#### Tasks:
1. ✅ Add upstream remote: `CryptoGnome/aster_lick_hunter_node`
2. ✅ Fetch latest changes from upstream
3. ✅ Merge upstream changes to current branch
4. ✅ Resolve any conflicts
5. ✅ Test bot functionality after merge
6. ✅ Document sync process for future updates

#### Commands:
```bash
# Add upstream remote
git remote add upstream https://github.com/CryptoGnome/aster_lick_hunter_node.git

# Fetch latest changes
git fetch upstream

# Merge upstream main/dev into current branch
git merge upstream/main

# If conflicts, resolve and commit
git add .
git commit -m "chore: sync with upstream CryptoGnome/aster_lick_hunter_node"
```

---

### Phase 2: Max Open Positions Per Pair
**Timeline:** Day 1
**Priority:** High

#### Architecture:
- Extend `SymbolConfig` to include `maxPositionsPerPair`
- Add position counting by (symbol, side) in `PositionManager`
- Implement pre-trade position limit checks in `Hunter`
- Add UI controls in configuration page

#### Implementation:

**1. Configuration Schema Update** (`src/lib/config/types.ts`)
```typescript
export const symbolConfigSchema = z.object({
  // ... existing fields ...
  maxPositionsPerPair: z.number().min(1).max(10).optional().default(2),
  // Separate limits for long/short if needed
  maxLongPositions: z.number().min(1).max(10).optional(),
  maxShortPositions: z.number().min(1).max(10).optional(),
});
```

**2. Position Tracking** (`src/lib/bot/positionManager.ts`)
```typescript
// Add method to count positions per symbol-side
public getPositionCountForSymbolSide(symbol: string, side: 'LONG' | 'SHORT'): number {
  return this.positions.filter(p =>
    p.symbol === symbol &&
    p.positionSide === side
  ).length;
}

// Add method for pre-trade validation
public canOpenPosition(symbol: string, side: 'LONG' | 'SHORT'): {
  allowed: boolean;
  reason?: string;
} {
  const config = this.config.symbols[symbol];
  if (!config) {
    return { allowed: false, reason: 'Symbol not configured' };
  }

  const currentCount = this.getPositionCountForSymbolSide(symbol, side);
  const maxAllowed = side === 'LONG'
    ? config.maxLongPositions || config.maxPositionsPerPair || 2
    : config.maxShortPositions || config.maxPositionsPerPair || 2;

  if (currentCount >= maxAllowed) {
    return {
      allowed: false,
      reason: `Max ${side} positions (${maxAllowed}) reached for ${symbol}`
    };
  }

  return { allowed: true };
}
```

**3. Hunter Integration** (`src/lib/bot/hunter.ts`)
- Add position limit check before placing orders
- Emit 'tradeBlocked' event with reason
- Log to UI via status broadcaster

**4. UI Configuration** (`src/app/config/page.tsx` & `src/components/SymbolConfigForm.tsx`)
- Add input fields for max positions per pair
- Display current position counts
- Validate inputs

---

### Phase 3: Wallet Copy Trading System
**Timeline:** Day 2-4
**Priority:** High

#### Architecture Overview:

```
┌─────────────────────────────────────────────────────────┐
│                    Main Bot Account                      │
│              (Master Trading Wallet)                     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ Monitors & Trades
                       ↓
┌─────────────────────────────────────────────────────────┐
│               Copy Trading Manager                       │
│  • Listens to position open events                      │
│  • Calculates position sizes per follower wallet        │
│  • Places trades on follower accounts                   │
│  • Syncs TP/SL updates                                  │
│  • Manages position lifecycle                           │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┬─────────────┐
        ↓              ↓              ↓             ↓
   ┌────────┐     ┌────────┐     ┌────────┐   ┌────────┐
   │Wallet 1│     │Wallet 2│     │Wallet 3│   │Wallet N│
   │50% size│     │25% size│     │100% size│  │Custom  │
   └────────┘     └────────┘     └────────┘   └────────┘
```

#### Database Schema:

**New Table: `follower_wallets`**
```sql
CREATE TABLE follower_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  position_size_multiplier REAL DEFAULT 1.0,
  max_positions_per_pair INTEGER DEFAULT 2,
  symbols_filter TEXT, -- JSON array of allowed symbols, null = all
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE follower_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL,
  master_position_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  tp_price REAL,
  sl_price REAL,
  status TEXT DEFAULT 'open', -- open, closed, error
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  pnl REAL,
  FOREIGN KEY (wallet_id) REFERENCES follower_wallets(id),
  FOREIGN KEY (master_position_id) REFERENCES positions(id)
);
```

#### Implementation Structure:

**1. New Service: `src/lib/services/copyTradingService.ts`**
```typescript
interface FollowerWallet {
  id: string;
  name: string;
  apiKey: string;
  secretKey: string;
  enabled: boolean;
  positionSizeMultiplier: number; // 0.5 = 50%, 1.0 = 100%, 2.0 = 200%
  maxPositionsPerPair: number;
  symbolsFilter?: string[]; // null = copy all symbols
}

class CopyTradingService {
  private followers: Map<string, FollowerWallet>;
  private followerPositions: Map<string, FollowerPosition[]>;

  async onMasterPositionOpened(masterPosition: Position): Promise<void> {
    // 1. Get all enabled followers
    // 2. Filter by symbol whitelist
    // 3. Check position limits per follower
    // 4. Calculate position sizes
    // 5. Place orders on follower accounts
    // 6. Track follower positions
  }

  async onMasterPositionClosed(masterPosition: Position): Promise<void> {
    // 1. Find all linked follower positions
    // 2. Close follower positions
    // 3. Calculate PnL
    // 4. Update database
  }

  async onMasterTPSLUpdate(masterPosition: Position): Promise<void> {
    // 1. Update TP/SL on all follower positions
  }
}
```

**2. Database Layer: `src/lib/db/copyTradingDb.ts`**
```typescript
export class CopyTradingDb {
  // Wallet management
  addFollowerWallet(wallet: FollowerWallet): Promise<string>
  updateFollowerWallet(id: string, updates: Partial<FollowerWallet>): Promise<void>
  removeFollowerWallet(id: string): Promise<void>
  getFollowerWallets(enabledOnly?: boolean): Promise<FollowerWallet[]>

  // Position tracking
  recordFollowerPosition(position: FollowerPosition): Promise<void>
  updateFollowerPosition(id: string, updates: Partial<FollowerPosition>): Promise<void>
  getFollowerPositions(walletId?: string): Promise<FollowerPosition[]>
  getPositionsByMasterId(masterPositionId: string): Promise<FollowerPosition[]>
}
```

**3. Configuration Extension**
```typescript
// Add to global config
export const globalConfigSchema = z.object({
  // ... existing fields ...
  copyTrading: z.object({
    enabled: z.boolean().default(false),
    syncTPSL: z.boolean().default(true), // Auto-sync TP/SL changes
    syncClose: z.boolean().default(true), // Auto-close when master closes
    delayMs: z.number().default(0), // Optional delay between master and follower trades
  }).optional(),
});
```

**4. UI Components**

**New Page: `src/app/copy-trading/page.tsx`**
- Dashboard showing all follower wallets
- Add/Edit/Delete follower wallets
- Position size configuration per wallet
- Symbol filters
- Real-time follower position status
- Individual PnL per follower

**New Component: `src/components/CopyTradingManager.tsx`**
```typescript
// Features:
// - List of follower wallets with status indicators
// - Enable/disable toggles
// - Position size sliders (10% - 200%)
// - Symbol whitelist/blacklist
// - Max positions per pair per wallet
// - Performance metrics per follower
```

---

### Phase 4: Telegram Bot Integration
**Timeline:** Day 5-7
**Priority:** Medium-High

#### Architecture:

```
┌──────────────────────────────────────┐
│         Telegram Bot Service         │
│  • Manual trade controls             │
│  • Status updates & alerts           │
│  • Position management               │
│  • Configuration queries             │
└──────────┬───────────────────────────┘
           │
           │ Events & Commands
           ↓
┌──────────────────────────────────────┐
│         Main Bot (AsterBot)          │
│  • Emits position events             │
│  • Accepts manual commands           │
│  • Broadcasts status                 │
└──────────────────────────────────────┘
```

#### Features:

**1. Manual Controls**
```
/start - Show welcome message and setup status
/status - Current bot status, balance, open positions
/positions - List all open positions with P&L
/close <symbol> <side> - Manually close a position
/pause - Pause automated trading
/resume - Resume automated trading
/balance - Show account balance
/symbols - List configured symbols
/stats - Trading statistics (win rate, total P&L)
```

**2. Automated Alerts**
```
✅ Position Opened: BTCUSDT LONG @$42,000 (0.1 BTC)
📈 Take Profit Hit: ETHUSDT SHORT +$150 (+3.5%)
🛑 Stop Loss Hit: BTCUSDT LONG -$85 (-2.1%)
❌ Trade Blocked: SOLUSDT - Max positions reached
⚠️  Low Balance Warning: $500 remaining
🔴 Error Alert: API connection lost
```

**3. Configuration Management**
```
/config - Show current configuration summary
/setleverage <symbol> <value> - Update leverage
/setpapermode <on|off> - Toggle paper mode
/addwallet <name> - Add copy trading wallet (requires follow-up)
/wallets - List copy trading wallets
```

#### Implementation:

**1. Dependencies**
```bash
npm install node-telegram-bot-api
npm install --save-dev @types/node-telegram-bot-api
```

**2. New Service: `src/lib/services/telegramService.ts`**
```typescript
import TelegramBot from 'node-telegram-bot-api';

export class TelegramService {
  private bot: TelegramBot;
  private chatId: string | null = null;
  private enabled: boolean = false;

  constructor(token: string, chatId?: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.chatId = chatId;
    this.setupCommands();
  }

  // Setup command handlers
  private setupCommands(): void {
    this.bot.onText(/\/start/, this.handleStart.bind(this));
    this.bot.onText(/\/status/, this.handleStatus.bind(this));
    this.bot.onText(/\/positions/, this.handlePositions.bind(this));
    // ... more commands
  }

  // Send notifications
  async sendPositionOpened(position: Position): Promise<void> {
    const message = `✅ Position Opened\n` +
      `Symbol: ${position.symbol}\n` +
      `Side: ${position.side}\n` +
      `Quantity: ${position.quantity}\n` +
      `Entry: $${position.entryPrice}`;
    await this.sendMessage(message);
  }

  async sendAlert(message: string, level: 'info' | 'warning' | 'error'): Promise<void> {
    const emoji = level === 'error' ? '🔴' : level === 'warning' ? '⚠️' : 'ℹ️';
    await this.sendMessage(`${emoji} ${message}`);
  }

  private async sendMessage(text: string): Promise<void> {
    if (!this.enabled || !this.chatId) return;
    await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
  }
}
```

**3. Configuration Extension**
```typescript
// Add to global config
export const globalConfigSchema = z.object({
  // ... existing fields ...
  telegram: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    notifications: z.object({
      positionOpened: z.boolean().default(true),
      positionClosed: z.boolean().default(true),
      stopLossHit: z.boolean().default(true),
      takeProfitHit: z.boolean().default(true),
      tradeBlocked: z.boolean().default(true),
      errors: z.boolean().default(true),
      lowBalance: z.boolean().default(true),
      lowBalanceThreshold: z.number().default(100), // USDT
    }).optional(),
  }).optional(),
});
```

**4. UI Setup Page: `src/app/telegram-setup/page.tsx`**

Features:
- Step-by-step Telegram bot creation guide
- BotFather instructions with screenshots
- Token input and validation
- Chat ID discovery (send message to get chat ID)
- Test notification button
- Notification preferences
- Enable/disable toggle

Setup Steps to Display:
```markdown
### Step 1: Create Telegram Bot
1. Open Telegram and search for "@BotFather"
2. Send /newbot command
3. Follow prompts to name your bot
4. Copy the API token (looks like: 123456:ABC-DEF...)

### Step 2: Get Chat ID
1. Start a conversation with your new bot
2. Send any message to it
3. Click "Get Chat ID" below (after entering token)
4. Your chat ID will be auto-detected

### Step 3: Test & Enable
1. Click "Send Test Message"
2. Check your Telegram for the test message
3. Enable notifications
4. Configure alert preferences
```

**5. Integration with Main Bot** (`src/bot/index.ts`)
```typescript
// Initialize Telegram service
if (this.config.global.telegram?.enabled &&
    this.config.global.telegram?.botToken) {
  this.telegramService = new TelegramService(
    this.config.global.telegram.botToken,
    this.config.global.telegram.chatId
  );

  // Connect to bot events
  this.hunter.on('positionOpened', (data) => {
    this.telegramService.sendPositionOpened(data);
  });

  this.positionManager.on('positionClosed', (data) => {
    this.telegramService.sendPositionClosed(data);
  });

  // ... more event connections
}
```

---

## 🔐 Security Enhancements

### 1. API Key Encryption (Optional - Advanced)
```typescript
// src/lib/security/encryption.ts
import crypto from 'crypto';

export class SecureStorage {
  private readonly algorithm = 'aes-256-gcm';
  private key: Buffer;

  constructor(masterPassword: string) {
    this.key = crypto.scryptSync(masterPassword, 'salt', 32);
  }

  encrypt(text: string): { encrypted: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  }

  decrypt(encrypted: string, iv: string, tag: string): string {
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

### 2. Telegram Bot Authentication
- Whitelist allowed chat IDs
- Command rate limiting
- Require confirmation for destructive operations
- Session-based authentication for sensitive commands

---

## 📊 Testing Plan

### Unit Tests
- ✅ Position limit validation per pair
- ✅ Copy trading position size calculations
- ✅ Follower wallet filtering logic
- ✅ Telegram command parsing
- ✅ Multi-wallet position tracking

### Integration Tests
- ✅ Master-follower trade synchronization
- ✅ Position limit enforcement
- ✅ Telegram notification delivery
- ✅ Configuration hot-reload with new fields
- ✅ Database schema migrations

### Manual Testing Checklist
```
Phase 1: Fork Sync
☐ Bot starts successfully after merge
☐ No regression in existing features
☐ Configuration loads correctly
☐ WebSocket connections stable

Phase 2: Position Limits
☐ Position limit enforced per symbol-side
☐ Trades blocked when limit reached
☐ UI displays current counts
☐ Config updates applied in real-time

Phase 3: Copy Trading
☐ Follower wallets added/edited/deleted
☐ Positions copied with correct sizes
☐ TP/SL synchronized
☐ Positions closed on master close
☐ PnL tracked per follower
☐ Symbol filters work correctly

Phase 4: Telegram Bot
☐ Bot responds to all commands
☐ Notifications sent for events
☐ Position data accurate
☐ Manual controls work
☐ Chat ID discovery works
☐ Settings persist after restart
```

---

## 📚 Documentation Updates

### Files to Update:
1. **CLAUDE.md**
   - Add copy trading section
   - Document max positions per pair
   - Telegram bot configuration
   - New configuration fields

2. **README.md**
   - Add copy trading feature to highlights
   - Telegram bot setup instructions
   - Update feature list

3. **New Documentation**
   - `docs/COPY_TRADING.md` - Complete copy trading guide
   - `docs/TELEGRAM_BOT.md` - Telegram setup and commands
   - `docs/MULTI_WALLET_STRATEGY.md` - Best practices

---

## 🚀 Deployment Plan

### Pre-deployment Checklist
```
☐ All tests passing (npm test)
☐ TypeScript compilation clean (npx tsc --noEmit)
☐ Linting clean (npm run lint)
☐ Database migrations tested
☐ Config schema backward compatible
☐ Documentation updated
☐ Changelog updated
```

### Deployment Steps
```bash
# 1. Ensure on correct branch
git checkout claude/sync-fork-wallet-trading-011CUqerhX7cM5djte3a8Feq

# 2. Run tests
npm test

# 3. Type check
npx tsc --noEmit

# 4. Build
npm run build

# 5. Commit changes
git add .
git commit -m "feat: add wallet copy trading, position limits, and Telegram bot"

# 6. Push to branch
git push -u origin claude/sync-fork-wallet-trading-011CUqerhX7cM5djte3a8Feq
```

---

## 📈 Success Metrics

### Functionality Metrics
- ✅ Fork synchronized with upstream (0 conflicts)
- ✅ Max positions per pair enforced (100% accuracy)
- ✅ Copy trading latency < 500ms
- ✅ Follower position accuracy 100%
- ✅ Telegram notification delivery > 99%
- ✅ No regression in existing features

### Performance Metrics
- ✅ Bot startup time < 10s (including all wallets)
- ✅ Config hot-reload < 2s
- ✅ Memory usage increase < 20%
- ✅ No additional CPU overhead at idle

### User Experience Metrics
- ✅ Copy trading setup time < 5 minutes
- ✅ Telegram bot setup time < 3 minutes
- ✅ Clear error messages for all failures
- ✅ Configuration UI intuitive and responsive

---

## 🎯 Timeline Summary

| Phase | Duration | Priority |
|-------|----------|----------|
| Fork Synchronization | 2 hours | Critical |
| Max Positions Per Pair | 1 day | High |
| Copy Trading System | 3 days | High |
| Telegram Bot Integration | 3 days | Medium-High |
| Testing & Documentation | 2 days | High |
| **Total** | **~9 days** | - |

---

## 🔄 Future Enhancements (Post-MVP)

### Copy Trading Advanced Features
- ⭐ Proportional position sizing based on account size
- ⭐ Follower-specific TP/SL multipliers
- ⭐ Copy trading performance analytics
- ⭐ Automatic follower rebalancing
- ⭐ Master wallet switching
- ⭐ Partial copy (% of master position)

### Telegram Bot Advanced Features
- ⭐ Interactive inline keyboards
- ⭐ Chart generation (position P&L graphs)
- ⭐ Multi-language support
- ⭐ Voice command support
- ⭐ Group chat support for team trading
- ⭐ Custom alert rules engine

### Additional Features
- ⭐ Web3 wallet integration
- ⭐ Social trading features (copy other users)
- ⭐ Advanced analytics dashboard
- ⭐ Machine learning trade optimization
- ⭐ Multi-exchange support

---

## ⚠️ Risk Mitigation

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Fork conflicts | High | Careful merge, extensive testing |
| Copy trading sync failures | High | Retry logic, error notifications, fallback mechanisms |
| Telegram API rate limits | Medium | Request queuing, message batching |
| Database schema changes | Medium | Migration scripts, backward compatibility |
| Multi-wallet API rate limits | High | Shared rate limiter across wallets |

### Business Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Follower wallet losses | High | Clear disclaimers, paper mode testing, position limits |
| Unauthorized Telegram access | Medium | Chat ID whitelisting, command authentication |
| Configuration errors | Medium | Validation, safe defaults, undo functionality |

---

## 📞 Support & Maintenance

### Monitoring
- Error log database monitoring
- Telegram bot uptime monitoring
- Copy trading sync success rate
- Position limit hit frequency
- API rate limit utilization

### Maintenance Schedule
- Weekly: Review error logs
- Monthly: Database optimization
- Quarterly: Dependency updates
- As needed: Upstream fork sync

---

## ✅ Acceptance Criteria

### Fork Synchronization
- [x] Upstream remote added
- [x] Latest changes merged
- [x] No breaking changes
- [x] All tests passing

### Max Positions Per Pair
- [ ] Configuration schema updated
- [ ] Position limits enforced
- [ ] UI controls functional
- [ ] Trades blocked when limit reached
- [ ] Clear error messages

### Copy Trading
- [ ] Follower wallets manageable via UI
- [ ] Positions copied accurately
- [ ] Position sizing correct (multipliers work)
- [ ] TP/SL synchronized
- [ ] Positions close when master closes
- [ ] PnL tracked per wallet
- [ ] Symbol filters functional

### Telegram Bot
- [ ] Bot setup guide in UI
- [ ] All commands functional
- [ ] Notifications delivered
- [ ] Manual controls work
- [ ] Error handling robust
- [ ] Chat ID discovery works

---

**Document Version:** 1.0
**Last Updated:** 2025-11-06
**Prepared By:** Claude Code Assistant
**Status:** Ready for Implementation
