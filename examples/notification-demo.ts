// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION SERVICE DEMO
// Example usage of Telegram/Discord notifications
// ═══════════════════════════════════════════════════════════════════════════

import { config as dotenvConfig } from 'dotenv';
import { NotificationService } from '../src/utils/notifications';
import { Logger } from '../src/utils/logger';
import { TradeResult } from '../src/types';

dotenvConfig();

async function main() {
    const logger = new Logger('NotificationDemo');

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP
    // ─────────────────────────────────────────────────────────────────────────
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

    if (!telegramToken && !discordWebhook) {
        console.error('❌ No notification credentials found!');
        console.error('Please set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID or DISCORD_WEBHOOK_URL in .env');
        process.exit(1);
    }

    const notificationService = new NotificationService({
        telegram: telegramToken && telegramChatId ? {
            enabled: true,
            botToken: telegramToken,
            chatId: telegramChatId
        } : undefined,
        discord: discordWebhook ? {
            enabled: true,
            webhookUrl: discordWebhook
        } : undefined
    });

    console.log('✅ Notification service initialized\n');

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 1: Trade Opened
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📤 Sending trade opened notification...');
    await notificationService.notifyTradeOpened(
        'LONG',
        'BTC',
        42500,
        0.5,
        41800,
        43500
    );
    console.log('✅ Trade opened notification sent\n');

    await sleep(2000);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 2: Trade Closed (Win)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📤 Sending winning trade notification...');
    const winningTrade: TradeResult = {
        side: 'LONG',
        entryPrice: 42500,
        exitPrice: 43200,
        pnl: 350,
        pnlPercent: 3.5,
        duration: 3600000 * 2.5, // 2.5 hours
        exitReason: 'TP'
    };

    await notificationService.notifyTradeClosed(winningTrade, 'BTC');
    console.log('✅ Winning trade notification sent\n');

    await sleep(2000);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 3: Trade Closed (Loss)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📤 Sending losing trade notification...');
    const losingTrade: TradeResult = {
        side: 'SHORT',
        entryPrice: 43000,
        exitPrice: 43300,
        pnl: -150,
        pnlPercent: -1.5,
        duration: 3600000 * 0.75, // 45 minutes
        exitReason: 'SL'
    };

    await notificationService.notifyTradeClosed(losingTrade, 'BTC');
    console.log('✅ Losing trade notification sent\n');

    await sleep(2000);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 4: Risk Alert
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📤 Sending risk alert...');
    await notificationService.notifyRiskAlert(
        'Maximum daily loss reached! Bot will pause trading.',
        'critical'
    );
    console.log('✅ Risk alert sent\n');

    await sleep(2000);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 5: Daily Summary
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📤 Sending daily summary...');
    const mockState = {
        position: null,
        dailyPnl: 450,
        dailyTrades: 5,
        lastTradeTime: Date.now(),
        lastLossTime: 0,
        isActive: true,
        equity: 10450,
        trades: [winningTrade, losingTrade]
    };

    await notificationService.notifyDailySummary(mockState);
    console.log('✅ Daily summary sent\n');

    await sleep(2000);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 6: Error Notification
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📤 Sending error notification...');
    const mockError = new Error('API connection timeout after 5 retries');
    await notificationService.notifyError(mockError, 'Exchange API');
    console.log('✅ Error notification sent\n');

    console.log('🎉 All notification demos completed!');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
