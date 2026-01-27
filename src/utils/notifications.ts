// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION SERVICE
// Telegram and Discord alerts for trading events
// ═══════════════════════════════════════════════════════════════════════════

import TelegramBot from 'node-telegram-bot-api';
import { Logger } from './logger';
import { TradeResult, BotState } from '../types';

export interface NotificationConfig {
    telegram?: {
        enabled: boolean;
        botToken: string;
        chatId: string;
    };
    discord?: {
        enabled: boolean;
        webhookUrl: string;
    };
}

export interface TradeAlert {
    type: 'trade' | 'position' | 'risk' | 'error';
    title: string;
    message: string;
    severity: 'info' | 'success' | 'warning' | 'error';
}

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATION SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class NotificationService {
    private logger: Logger;
    private config: NotificationConfig;
    private telegramBot?: TelegramBot;

    constructor(config: NotificationConfig) {
        this.logger = new Logger('Notifications');
        this.config = config;

        // Initialize Telegram if enabled
        if (config.telegram?.enabled && config.telegram.botToken) {
            try {
                this.telegramBot = new TelegramBot(config.telegram.botToken, {
                    polling: false
                });
                this.logger.info('Telegram bot initialized');
            } catch (error) {
                this.logger.error('Failed to initialize Telegram bot', error as Error);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEND ALERT
    // ─────────────────────────────────────────────────────────────────────────
    async sendAlert(alert: TradeAlert): Promise<void> {
        const promises: Promise<void>[] = [];

        if (this.config.telegram?.enabled) {
            promises.push(this.sendTelegram(alert));
        }

        if (this.config.discord?.enabled) {
            promises.push(this.sendDiscord(alert));
        }

        if (promises.length > 0) {
            await Promise.allSettled(promises);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TRADE NOTIFICATIONS
    // ─────────────────────────────────────────────────────────────────────────
    async notifyTradeOpened(
        side: 'LONG' | 'SHORT',
        symbol: string,
        entryPrice: number,
        size: number,
        stopLoss: number,
        takeProfit: number
    ): Promise<void> {
        const emoji = side === 'LONG' ? '🟢' : '🔴';

        await this.sendAlert({
            type: 'position',
            title: `${emoji} Position Opened`,
            message:
                `Symbol: ${symbol}\n` +
                `Side: ${side}\n` +
                `Entry: $${entryPrice.toFixed(2)}\n` +
                `Size: ${size.toFixed(4)}\n` +
                `Stop Loss: $${stopLoss.toFixed(2)}\n` +
                `Take Profit: $${takeProfit.toFixed(2)}`,
            severity: 'info'
        });
    }

    async notifyTradeClosed(result: TradeResult, symbol: string): Promise<void> {
        const emoji = result.pnl >= 0 ? '✅' : '❌';
        const severity = result.pnl >= 0 ? 'success' : 'warning';

        await this.sendAlert({
            type: 'trade',
            title: `${emoji} Trade Closed`,
            message:
                `Symbol: ${symbol}\n` +
                `Side: ${result.side}\n` +
                `Entry: $${result.entryPrice.toFixed(2)}\n` +
                `Exit: $${result.exitPrice.toFixed(2)}\n` +
                `PnL: $${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(2)}%)\n` +
                `Reason: ${result.exitReason}\n` +
                `Duration: ${(result.duration / 60000).toFixed(1)} min`,
            severity
        });
    }

    async notifyDailySummary(state: BotState): Promise<void> {
        const totalTrades = state.trades.length;
        const winningTrades = state.trades.filter(t => t.pnl > 0).length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const dailyPnlPercent = (state.dailyPnl / state.equity) * 100;

        await this.sendAlert({
            type: 'trade',
            title: '📊 Daily Summary',
            message:
                `Equity: $${state.equity.toFixed(2)}\n` +
                `Daily PnL: $${state.dailyPnl.toFixed(2)} (${dailyPnlPercent.toFixed(2)}%)\n` +
                `Daily Trades: ${state.dailyTrades}\n` +
                `Total Trades: ${totalTrades}\n` +
                `Win Rate: ${winRate.toFixed(1)}%\n` +
                `Position: ${state.position ? state.position.side : 'NONE'}`,
            severity: state.dailyPnl >= 0 ? 'success' : 'warning'
        });
    }

    async notifyRiskAlert(message: string, severity: 'info' | 'warning' | 'error' = 'warning'): Promise<void> {
        await this.sendAlert({
            type: 'risk',
            title: '⚠️ Risk Alert',
            message,
            severity
        });
    }

    async notifyError(error: Error, context: string): Promise<void> {
        await this.sendAlert({
            type: 'error',
            title: '🚨 Error Alert',
            message: `Context: ${context}\nError: ${error.message}\n\nStack: ${error.stack?.substring(0, 500)}`,
            severity: 'error'
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TELEGRAM IMPLEMENTATION
    // ─────────────────────────────────────────────────────────────────────────
    private async sendTelegram(alert: TradeAlert): Promise<void> {
        if (!this.telegramBot || !this.config.telegram?.chatId) return;

        try {
            const emojiMap = {
                info: 'ℹ️',
                success: '✅',
                warning: '⚠️',
                error: '🚨'
            };

            const message = `${emojiMap[alert.severity]} *${alert.title}*\n\n${alert.message}`;

            await this.telegramBot.sendMessage(this.config.telegram.chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

            this.logger.debug('Telegram notification sent');
        } catch (error) {
            this.logger.error('Failed to send Telegram notification', error as Error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DISCORD IMPLEMENTATION
    // ─────────────────────────────────────────────────────────────────────────
    private async sendDiscord(alert: TradeAlert): Promise<void> {
        if (!this.config.discord?.webhookUrl) return;

        try {
            const colorMap = {
                info: 3447003, // Blue
                success: 3066993, // Green
                warning: 16776960, // Yellow
                error: 15158332 // Red
            };

            const embed = {
                title: alert.title,
                description: alert.message,
                color: colorMap[alert.severity],
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Perp DEX Bot'
                }
            };

            const response = await fetch(this.config.discord.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] })
            });

            if (!response.ok) {
                throw new Error(`Discord webhook failed: ${response.statusText}`);
            }

            this.logger.debug('Discord notification sent');
        } catch (error) {
            this.logger.error('Failed to send Discord notification', error as Error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST NOTIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    async testNotification(): Promise<void> {
        await this.sendAlert({
            type: 'trade',
            title: '🧪 Test Notification',
            message: 'Bot notifications are working correctly!',
            severity: 'info'
        });
    }
}
