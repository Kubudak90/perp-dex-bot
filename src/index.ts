// ═══════════════════════════════════════════════════════════════════════════
// PERP DEX BOT - DASHBOARD-FIRST ENTRY POINT
// Control bot entirely from web dashboard
// ═══════════════════════════════════════════════════════════════════════════

import { config as dotenvConfig } from 'dotenv';
import { PerpBot, BotServices } from './bot';
import { BotConfig, ExchangeType, ExchangeConfig, BotState, TradeResult } from './types';
import { MockExchange, IExchange } from './utils/exchange';
import { createExchange } from './utils/exchanges';
import { loadConfigFromEnv } from './utils/config';
import { logError } from './utils/errors';
import { NotificationService } from './utils/notifications';
import { DatabaseService } from './utils/database';
import { AnalyticsService } from './utils/analytics';
import { Logger } from './utils/logger';
import { Dashboard, RuntimeCredentials } from './dashboard';

dotenvConfig();

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIGURATION (can be overridden by dashboard)
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG: BotConfig = {
    symbol: 'BTC',
    timeframe: '15m',
    leverage: 3,
    supertrendPeriod: 10,
    supertrendMultiplier: 3,
    emaFastPeriod: 50,
    emaSlowPeriod: 200,
    adxPeriod: 14,
    adxThreshold: 20,
    fundingThreshold: 0.0005,
    useFundingFilter: true,
    atrPeriod: 14,
    atrLookback: 100,
    minAtrPercentile: 20,
    maxAtrPercentile: 90,
    risk: {
        maxPositionSize: 20,
        maxDailyLoss: 3,
        maxDailyTrades: 3,
        riskRewardRatio: 1.5,
        stopLossAtrMultiplier: 1.5,
        cooldownMinutes: 30
    }
};

// ─────────────────────────────────────────────────────────────────────────
// BOT MANAGER - Controls bot lifecycle from dashboard
// ─────────────────────────────────────────────────────────────────────────
class BotManager {
    private bot: PerpBot | null = null;
    private exchange: IExchange | null = null;
    private services: BotServices = {};
    private logger: Logger;
    private currentCredentials: RuntimeCredentials | null = null;
    private dashboard: Dashboard | null = null;

    // Default state when no bot is running
    private defaultState: BotState = {
        position: null,
        dailyPnl: 0,
        dailyTrades: 0,
        lastTradeTime: 0,
        lastLossTime: 0,
        isActive: false,
        equity: 10000,
        trades: []
    };

    constructor() {
        this.logger = new Logger('BotManager');
    }

    get isRunning(): boolean {
        return this.bot?.isRunning ?? false;
    }

    getState(): BotState {
        if (this.bot) {
            return this.bot.getState();
        }
        return {
            ...this.defaultState,
            equity: this.currentCredentials?.paperBalance || 10000
        };
    }

    getConfig(): any {
        if (this.currentCredentials) {
            return {
                ...DEFAULT_CONFIG,
                symbol: this.currentCredentials.symbol,
                timeframe: this.currentCredentials.timeframe,
                leverage: this.currentCredentials.leverage,
                mode: this.currentCredentials.mode,
                paperBalance: this.currentCredentials.paperBalance,
                exchange: this.currentCredentials.exchange
            };
        }
        return { ...DEFAULT_CONFIG, mode: 'paper', paperBalance: 10000 };
    }

    async startBot(credentials: RuntimeCredentials): Promise<void> {
        if (this.isRunning) {
            throw new Error('Bot is already running');
        }

        this.currentCredentials = credentials;
        this.logger.info(`Starting bot on ${credentials.exchange} (${credentials.mode} mode)`);

        try {
            // Create exchange based on credentials
            if (credentials.mode === 'live') {
                const exchangeConfig: ExchangeConfig = {
                    exchange: credentials.exchange,
                    testnet: credentials.testnet,
                    privateKey: credentials.privateKey,
                    walletAddress: credentials.walletAddress,
                    grvtApiKey: credentials.apiKey,
                    grvtSubAccountId: credentials.subAccountId,
                    pacificaApiKey: credentials.apiKey
                };
                this.exchange = createExchange(exchangeConfig);
            } else {
                this.exchange = new MockExchange(credentials.paperBalance);
            }

            // Build config from credentials
            const config: BotConfig = {
                ...loadConfigFromEnv(DEFAULT_CONFIG),
                symbol: credentials.symbol,
                timeframe: credentials.timeframe,
                leverage: credentials.leverage
            };

            // Initialize services
            this.initializeServices();

            // Create and start bot
            this.bot = new PerpBot(config, this.exchange, this.services);
            await this.bot.initialize();
            await this.bot.start();

            this.logger.success(`Bot started successfully on ${credentials.exchange}`);

        } catch (error) {
            this.logger.error('Failed to start bot', error as Error);
            this.cleanup();
            throw error;
        }
    }

    async stopBot(): Promise<void> {
        if (!this.isRunning) {
            throw new Error('Bot is not running');
        }

        this.logger.info('Stopping bot...');

        if (this.bot) {
            this.bot.stop();
        }

        this.cleanup();
        this.logger.success('Bot stopped');
    }

    private initializeServices(): void {
        // Database
        const enableDatabase = process.env.ENABLE_DATABASE !== 'false';
        if (enableDatabase) {
            try {
                const dbPath = process.env.DATABASE_PATH || './data/trades.db';
                this.services.database = new DatabaseService(dbPath);
                this.logger.info(`Database enabled: ${dbPath}`);
            } catch (error) {
                this.logger.warn('Database initialization failed');
            }
        }

        // Notifications
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const telegramChatId = process.env.TELEGRAM_CHAT_ID;
        const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

        if (telegramToken && telegramChatId) {
            try {
                this.services.notifications = new NotificationService({
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
                this.logger.info('Notifications enabled');
            } catch (error) {
                this.logger.warn('Notifications initialization failed');
            }
        }

        // Analytics
        this.services.analytics = new AnalyticsService();
    }

    private cleanup(): void {
        this.bot = null;
        this.exchange = null;
        if (this.services.database) {
            this.services.database.close();
        }
        this.services = {};
    }

    updateDashboardPrice(price: number): void {
        if (this.dashboard) {
            this.dashboard.updatePrice(price);
        }
    }

    setDashboard(dashboard: Dashboard): void {
        this.dashboard = dashboard;
    }
}

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
  ║   Multi-Exchange Perpetual Trading Bot                                ║
  ║   Supported: Nado | GRVT | Pacifica | StandX                          ║
  ║   Version 2.0.0                                                       ║
  ║                                                                       ║
  ╚═══════════════════════════════════════════════════════════════════════╝
  `);

    const logger = new Logger('Main');

    try {
        // Initialize bot manager
        const botManager = new BotManager();

        // Get dashboard config
        const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3001', 10);

        // Start dashboard
        const dashboard = new Dashboard(
            { port: dashboardPort, enabled: true },
            {
                getState: () => botManager.getState(),
                getConfig: () => botManager.getConfig(),
                onStartBot: async (credentials: RuntimeCredentials) => {
                    await botManager.startBot(credentials);
                },
                onStopBot: async () => {
                    await botManager.stopBot();
                },
                isRunning: () => botManager.isRunning
            }
        );

        botManager.setDashboard(dashboard);
        dashboard.start();

        console.log('');
        console.log('  ┌────────────────────────────────────────────────────────────┐');
        console.log(`  │  🌐 Dashboard: http://localhost:${dashboardPort}                       │`);
        console.log('  │                                                            │');
        console.log('  │  Open the dashboard in your browser to:                    │');
        console.log('  │    1. Select exchange (Nado, GRVT, Pacifica, StandX)       │');
        console.log('  │    2. Enter API credentials                                │');
        console.log('  │    3. Configure trading parameters                         │');
        console.log('  │    4. Start/Stop the bot                                   │');
        console.log('  │                                                            │');
        console.log('  │  Press Ctrl+C to shutdown                                  │');
        console.log('  └────────────────────────────────────────────────────────────┘');
        console.log('');

        // Graceful shutdown
        const shutdown = async () => {
            console.log('\n🛑 Shutting down...');
            if (botManager.isRunning) {
                await botManager.stopBot();
            }
            dashboard.stop();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Keep process alive
        await new Promise(() => {});

    } catch (error) {
        logError(error);
        logger.error('Fatal error', error as Error);
        process.exit(1);
    }
}

main();
