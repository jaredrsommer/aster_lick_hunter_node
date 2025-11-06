// NOTE: This service requires 'node-telegram-bot-api' package
// Install with: npm install node-telegram-bot-api @types/node-telegram-bot-api

import { EventEmitter } from 'events';
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

// Type definitions (will be replaced by actual types when package is installed)
type TelegramBot = any;
type Message = any;

interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  notifications?: {
    positionOpened?: boolean;
    positionClosed?: boolean;
    stopLossHit?: boolean;
    takeProfitHit?: boolean;
    tradeBlocked?: boolean;
    errors?: boolean;
    lowBalance?: boolean;
    lowBalanceThreshold?: number;
  };
}

interface Position {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  pnl?: number;
}

export class TelegramService extends EventEmitter {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private enabled: boolean = false;
  private config: TelegramConfig | null = null;
  private botCommands: Map<string, (msg: Message, args: string[]) => Promise<void>> = new Map();

  constructor() {
    super();
  }

  async initialize(config: TelegramConfig): Promise<void> {
    this.config = config;
    this.enabled = config.enabled;

    if (!this.enabled) {
      logWithTimestamp('Telegram Bot: Disabled in configuration');
      return;
    }

    if (!config.botToken) {
      logWarnWithTimestamp('Telegram Bot: No bot token configured');
      return;
    }

    this.chatId = config.chatId || null;

    try {
      // Dynamically import telegram bot (will fail gracefully if not installed)
      const TelegramBotModule = await import('node-telegram-bot-api');
      const TelegramBot = TelegramBotModule.default || TelegramBotModule;

      this.bot = new TelegramBot(config.botToken, { polling: true });

      // Register commands
      this.registerCommands();

      // Set bot commands for UI
      await this.bot.setMyCommands([
        { command: 'start', description: 'Show welcome message and bot status' },
        { command: 'status', description: 'Current bot status and balance' },
        { command: 'positions', description: 'List all open positions' },
        { command: 'balance', description: 'Show account balance' },
        { command: 'pause', description: 'Pause automated trading' },
        { command: 'resume', description: 'Resume automated trading' },
        { command: 'stats', description: 'Trading statistics (win rate, P&L)' },
        { command: 'help', description: 'Show all available commands' },
      ]);

      logWithTimestamp('✅ Telegram Bot initialized successfully');
      if (this.chatId) {
        await this.sendMessage('🤖 Bot started and connected!');
      }
    } catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logErrorWithTimestamp('Telegram Bot: node-telegram-bot-api package not installed');
        logErrorWithTimestamp('Install with: npm install node-telegram-bot-api @types/node-telegram-bot-api');
      } else {
        logErrorWithTimestamp('Telegram Bot: Initialization failed:', error.message);
      }
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.bot !== null;
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try {
        if (this.chatId) {
          await this.sendMessage('🛑 Bot stopped');
        }
        await this.bot.stopPolling();
        this.bot = null;
        logWithTimestamp('Telegram Bot: Stopped');
      } catch (error) {
        logErrorWithTimestamp('Telegram Bot: Error stopping:', error);
      }
    }
  }

  private registerCommands(): void {
    if (!this.bot) return;

    this.bot.onText(/\/start/, (msg) => this.handleStart(msg, []));
    this.bot.onText(/\/status/, (msg) => this.handleStatus(msg, []));
    this.bot.onText(/\/positions/, (msg) => this.handlePositions(msg, []));
    this.bot.onText(/\/balance/, (msg) => this.handleBalance(msg, []));
    this.bot.onText(/\/pause/, (msg) => this.handlePause(msg, []));
    this.bot.onText(/\/resume/, (msg) => this.handleResume(msg, []));
    this.bot.onText(/\/stats/, (msg) => this.handleStats(msg, []));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg, []));

    // Close position command: /close BTCUSDT LONG
    this.bot.onText(/\/close (.+)/, (msg: Message, match: RegExpExecArray | null) => {
      const args = match ? match[1].split(' ') : [];
      this.handleClose(msg, args);
    });
  }

  // ===== Command Handlers =====

  private async handleStart(msg: Message, _args: string[]): Promise<void> {
    const chatId = msg.chat.id.toString();

    // Auto-set chat ID if not configured
    if (!this.chatId) {
      this.chatId = chatId;
      this.emit('chatIdDiscovered', chatId);
    }

    const message = `
🤖 <b>Aster Liquidation Hunter Bot</b>

Welcome! I'm your trading bot assistant.

<b>Current Status:</b>
Bot: ${this.config ? '✅ Running' : '❌ Offline'}
Chat ID: <code>${chatId}</code>
Notifications: ${this.config?.notifications ? '✅ Enabled' : '❌ Disabled'}

Use /help to see all available commands.
    `;

    await this.sendMessageToChat(chatId, message);
  }

  private async handleStatus(msg: Message, _args: string[]): Promise<void> {
    this.emit('commandRequest', { command: 'status', chatId: msg.chat.id.toString() });
    // Response will be sent via emitted event handler in main bot
  }

  private async handlePositions(msg: Message, _args: string[]): Promise<void> {
    this.emit('commandRequest', { command: 'positions', chatId: msg.chat.id.toString() });
  }

  private async handleBalance(msg: Message, _args: string[]): Promise<void> {
    this.emit('commandRequest', { command: 'balance', chatId: msg.chat.id.toString() });
  }

  private async handlePause(msg: Message, _args: string[]): Promise<void> {
    this.emit('commandRequest', { command: 'pause', chatId: msg.chat.id.toString() });
  }

  private async handleResume(msg: Message, _args: string[]): Promise<void> {
    this.emit('commandRequest', { command: 'resume', chatId: msg.chat.id.toString() });
  }

  private async handleStats(msg: Message, _args: string[]): Promise<void> {
    this.emit('commandRequest', { command: 'stats', chatId: msg.chat.id.toString() });
  }

  private async handleClose(msg: Message, args: string[]): Promise<void> {
    if (args.length < 2) {
      await this.sendMessageToChat(
        msg.chat.id.toString(),
        '❌ Usage: /close SYMBOL SIDE\nExample: /close BTCUSDT LONG'
      );
      return;
    }

    const [symbol, side] = args;
    this.emit('commandRequest', {
      command: 'close',
      chatId: msg.chat.id.toString(),
      args: { symbol: symbol.toUpperCase(), side: side.toUpperCase() }
    });
  }

  private async handleHelp(msg: Message, _args: string[]): Promise<void> {
    const helpMessage = `
🤖 <b>Available Commands</b>

<b>Information:</b>
/start - Show welcome message
/status - Bot status and balance
/positions - List open positions
/balance - Account balance
/stats - Trading statistics

<b>Controls:</b>
/pause - Pause automated trading
/resume - Resume automated trading
/close SYMBOL SIDE - Close a position
  Example: /close BTCUSDT LONG

<b>Settings:</b>
/help - Show this help message

<b>Automatic Notifications:</b>
${this.config?.notifications?.positionOpened ? '✅' : '❌'} Position opened
${this.config?.notifications?.positionClosed ? '✅' : '❌'} Position closed
${this.config?.notifications?.stopLossHit ? '✅' : '❌'} Stop loss hit
${this.config?.notifications?.takeProfitHit ? '✅' : '❌'} Take profit hit
${this.config?.notifications?.tradeBlocked ? '✅' : '❌'} Trade blocked
${this.config?.notifications?.errors ? '✅' : '❌'} Errors
    `;

    await this.sendMessageToChat(msg.chat.id.toString(), helpMessage);
  }

  // ===== Notification Methods =====

  async sendPositionOpened(position: Position): Promise<void> {
    if (!this.shouldSendNotification('positionOpened')) return;

    const message = `
✅ <b>Position Opened</b>

Symbol: <code>${position.symbol}</code>
Side: <b>${position.side}</b>
Quantity: ${position.quantity}
Entry Price: $${position.entryPrice.toFixed(2)}
    `;

    await this.sendMessage(message);
  }

  async sendPositionClosed(position: Position): Promise<void> {
    if (!this.shouldSendNotification('positionClosed')) return;

    const pnlEmoji = position.pnl && position.pnl >= 0 ? '📈' : '📉';
    const pnlColor = position.pnl && position.pnl >= 0 ? '🟢' : '🔴';

    const message = `
${pnlEmoji} <b>Position Closed</b>

Symbol: <code>${position.symbol}</code>
Side: <b>${position.side}</b>
Quantity: ${position.quantity}
${position.pnl !== undefined ? `PnL: ${pnlColor} $${position.pnl.toFixed(2)}` : ''}
    `;

    await this.sendMessage(message);
  }

  async sendStopLossHit(position: Position): Promise<void> {
    if (!this.shouldSendNotification('stopLossHit')) return;

    const message = `
🛑 <b>Stop Loss Hit</b>

Symbol: <code>${position.symbol}</code>
Side: <b>${position.side}</b>
${position.pnl !== undefined ? `Loss: 🔴 $${position.pnl.toFixed(2)}` : ''}
    `;

    await this.sendMessage(message);
  }

  async sendTakeProfitHit(position: Position): Promise<void> {
    if (!this.shouldSendNotification('takeProfitHit')) return;

    const message = `
📈 <b>Take Profit Hit</b>

Symbol: <code>${position.symbol}</code>
Side: <b>${position.side}</b>
${position.pnl !== undefined ? `Profit: 🟢 $${position.pnl.toFixed(2)}` : ''}
    `;

    await this.sendMessage(message);
  }

  async sendTradeBlocked(symbol: string, side: string, reason: string): Promise<void> {
    if (!this.shouldSendNotification('tradeBlocked')) return;

    const message = `
❌ <b>Trade Blocked</b>

Symbol: <code>${symbol}</code>
Side: <b>${side}</b>
Reason: ${reason}
    `;

    await this.sendMessage(message);
  }

  async sendError(error: string): Promise<void> {
    if (!this.shouldSendNotification('errors')) return;

    const message = `
🔴 <b>Error</b>

${error}
    `;

    await this.sendMessage(message);
  }

  async sendLowBalanceWarning(currentBalance: number): Promise<void> {
    if (!this.shouldSendNotification('lowBalance')) return;

    const threshold = this.config?.notifications?.lowBalanceThreshold || 100;

    if (currentBalance > threshold) return;

    const message = `
⚠️ <b>Low Balance Warning</b>

Current Balance: $${currentBalance.toFixed(2)} USDT
Threshold: $${threshold} USDT

Please add funds to continue trading.
    `;

    await this.sendMessage(message);
  }

  async sendCustomMessage(text: string): Promise<void> {
    await this.sendMessage(text);
  }

  async sendCommandResponse(chatId: string, message: string): Promise<void> {
    await this.sendMessageToChat(chatId, message);
  }

  // ===== Helper Methods =====

  private shouldSendNotification(type: string): boolean {
    if (!this.enabled || !this.chatId || !this.config?.notifications) {
      return false;
    }

    return (this.config.notifications as any)[type] !== false;
  }

  private async sendMessage(text: string): Promise<void> {
    if (!this.chatId) return;
    await this.sendMessageToChat(this.chatId, text);
  }

  private async sendMessageToChat(chatId: string, text: string): Promise<void> {
    if (!this.bot) return;

    try {
      await this.bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      logErrorWithTimestamp('Telegram: Failed to send message:', error);
    }
  }

  getChatId(): string | null {
    return this.chatId;
  }

  setChatId(chatId: string): void {
    this.chatId = chatId;
  }
}

export const telegramService = new TelegramService();
