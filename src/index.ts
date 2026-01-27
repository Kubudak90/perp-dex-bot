// ═══════════════════════════════════════════════════════════════════════════
// PERP DEX BOT - ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

import { config as dotenvConfig } from 'dotenv';
import { PerpBot, BotServices } from './bot';
import { BotConfig } from './types';
import { MockExchange } from './utils/exchange';
import { loadConfigFromEnv, validateMode, printConfigSummary } from './utils/config';
import { logError } from './utils/errors';
import { NotificationService } from './utils/notifications';
import { DatabaseService } from './utils/database';
import { AnalyticsService } from './utils/analytics';
import { Logger } from './utils/logger';

dotenvConfig();

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG: BotConfig = {
    // Trading pair
    symbol: 'BTC',
    timeframe: '15m',
    leverage: 3,

    // Supertrend
    supertrendPeriod: 10,
    supertrendMultiplier: 3,

    // EMA - Trend filter
    emaFastPeriod: 50,
    emaSlowPeriod: 200,

    // ADX - Trend strength
    adxPeriod: 14,
    adxThreshold: 20,

    // Funding - Extreme positions against funding
    fundingThreshold: 0.0005,
    useFundingFilter: true,

    // Volatility regime
    atrPeriod: 14,
    atrLookback: 100,
    minAtrPercentile: 20,
    maxAtrPercentile: 90,

    // Risk Management
    risk: {
        maxPositionSize: 20,
        maxDailyLoss: 3,
        maxDailyTrades: 3,
        riskRewardRatio: 1.5,
        stopLossAtrMultiplier: 1.5,
        cooldownMinutes: 30,
        riskPerTrade: 1 // Risk 1% of equity per trade
    }
};

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║                                                                       ║
  ║   ██████╗ ███████╗██████╗ ██████╗     ██████╗  ██████╗ ████████╗     ║
  ║   ██╔══██╗██╔════╝██╔══██╗██╔══██╗    ██╔══██╗██╔═══██╗╚══██╔══╝     ║
  ║   ██████╔╝█████╗  ██████╔╝██████╔╝    ██████╔╝██║   ██║   ██║        ║
  ║   ██╔═══╝ ██╔══╝  ██╔══██╗██╔═══╝     ██╔══██╗██║   ██║   ██║        ║
  ║   ██║     ███████╗██║  ██║██║         ██████╔╝╚██████╔╝   ██║        ║
  ║   ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝         ╚═════╝  ╚═════╝    ╚═╝        ║
  ║                                                                       ║
  ║   Supertrend + EMA + ADX + Funding Filter                            ║
  ║   Version 1.0.0                                                       ║
  ║                                                                       ║
  ╚═══════════════════════════════════════════════════════════════════════╝
  `);

    try {
        // ─────────────────────────────────────────────────────────────────────────
        // VALIDATE MODE AND CREDENTIALS
        // ─────────────────────────────────────────────────────────────────────────
        const { mode, config: modeConfig } = validateMode();

        // Currently only paper trading mode is supported
        // To add real exchange support, implement BaseExchangeConnector
        if (mode === 'live') {
            console.log('⚠️  Live trading is not yet implemented.');
            console.log('   To enable live trading, implement a connector extending BaseExchangeConnector.');
            console.log('   Falling back to paper trading mode...\n');
        }

        const exchange = new MockExchange(modeConfig.initialBalance || 10000);
        console.log(`📝 PAPER MODE - Starting balance: $${modeConfig.initialBalance || 10000}`);

        // ─────────────────────────────────────────────────────────────────────────
        // LOAD AND VALIDATE CONFIGURATION
        // ─────────────────────────────────────────────────────────────────────────
        const config = loadConfigFromEnv(DEFAULT_CONFIG);
        printConfigSummary(config);

        // ─────────────────────────────────────────────────────────────────────────
        // INITIALIZE SERVICES (Optional)
        // ─────────────────────────────────────────────────────────────────────────
        const logger = new Logger('Main');
        const services: BotServices = {};

        // Database service
        const enableDatabase = process.env.ENABLE_DATABASE !== 'false';
        if (enableDatabase) {
            try {
                const dbPath = process.env.DATABASE_PATH || './data/trades.db';
                services.database = new DatabaseService(dbPath);
                console.log(`💾 Database enabled: ${dbPath}`);
            } catch (error) {
                logger.error('Failed to initialize database', error as Error);
                console.warn('⚠️  Database disabled due to error');
            }
        }

        // Notification service
        const enableNotifications = process.env.ENABLE_NOTIFICATIONS !== 'false';
        if (enableNotifications) {
            const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
            const telegramChatId = process.env.TELEGRAM_CHAT_ID;
            const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

            if (telegramToken && telegramChatId) {
                try {
                    services.notifications = new NotificationService({
                        telegram: {
                            enabled: true,
                            botToken: telegramToken,
                            chatId: telegramChatId
                        },
                        discord: discordWebhook ? {
                            enabled: true,
                            webhookUrl: discordWebhook
                        } : undefined
                    });
                    console.log('📢 Notifications enabled (Telegram)');
                } catch (error) {
                    logger.error('Failed to initialize notifications', error as Error);
                    console.warn('⚠️  Notifications disabled due to error');
                }
            } else if (discordWebhook) {
                try {
                    services.notifications = new NotificationService({
                        discord: {
                            enabled: true,
                            webhookUrl: discordWebhook
                        }
                    });
                    console.log('📢 Notifications enabled (Discord)');
                } catch (error) {
                    logger.error('Failed to initialize notifications', error as Error);
                    console.warn('⚠️  Notifications disabled due to error');
                }
            }
        }

        // Analytics service (always available)
        services.analytics = new AnalyticsService();

        // ─────────────────────────────────────────────────────────────────────────
        // START BOT
        // ─────────────────────────────────────────────────────────────────────────
        const bot = new PerpBot(config, exchange, services);

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down...');
            bot.stop();

            // Close database connection
            if (services.database) {
                services.database.close();
            }

            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Shutting down...');
            bot.stop();

            // Close database connection
            if (services.database) {
                services.database.close();
            }

            process.exit(0);
        });

        await bot.initialize();
        await bot.start();
    } catch (error) {
        logError(error);
        console.error('\n❌ Bot failed to start. Please check your configuration.');
        process.exit(1);
    }
}

main();
