// ═══════════════════════════════════════════════════════════════════════════
// PERP DEX BOT - ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

import { config as dotenvConfig } from 'dotenv';
import { PerpBot } from './bot';
import { BotConfig } from './types';
import { HyperliquidConnector, MockExchange } from './utils/exchange';
import { loadConfigFromEnv, validateMode, printConfigSummary } from './utils/config';
import { logError } from './utils/errors';

dotenvConfig();

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIGURATION
// Senin konuştuğumuz MVP setup
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG: BotConfig = {
    // Trading pair
    symbol: 'BTC',
    timeframe: '15m',        // 15m iyi denge: noise az, sinyaller net
    leverage: 3,             // Düşük başla, sonra ayarla

    // Supertrend - Kıvanç Hoca's magic
    supertrendPeriod: 10,
    supertrendMultiplier: 3,

    // EMA - Trend filtresi
    emaFastPeriod: 50,
    emaSlowPeriod: 200,

    // ADX - Trend strength
    adxPeriod: 14,
    adxThreshold: 20,        // 20+ = trend var

    // Funding - Extreme positions against funding
    fundingThreshold: 0.0005, // 0.05% = extreme
    useFundingFilter: true,

    // Volatility regime
    atrPeriod: 14,
    atrLookback: 100,        // 100 candle lookback for percentile
    minAtrPercentile: 20,    // Avoid dead markets
    maxAtrPercentile: 90,    // Avoid chaos

    // Risk Management - EN ÖNEMLİ KISIM
    risk: {
        maxPositionSize: 20,       // Max %20 of equity per trade
        maxDailyLoss: 3,           // Günlük max %3 DD
        maxDailyTrades: 3,         // Max 3 trade/day (overtrading = ölüm)
        riskRewardRatio: 1.5,      // 1:1.5 RR
        stopLossAtrMultiplier: 1.5, // SL = 1.5 * ATR
        cooldownMinutes: 30        // 30 dk cooldown after loss
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

        let exchange;

        if (mode === 'live') {
            exchange = new HyperliquidConnector(
                modeConfig.privateKey,
                modeConfig.walletAddress,
                modeConfig.testnet
            );
            console.log('⚠️  LIVE MODE - Real money at risk!');
        } else {
            exchange = new MockExchange(modeConfig.initialBalance);
            console.log(`📝 PAPER MODE - Starting balance: $${modeConfig.initialBalance}`);
        }

        // ─────────────────────────────────────────────────────────────────────────
        // LOAD AND VALIDATE CONFIGURATION
        // ─────────────────────────────────────────────────────────────────────────
        const config = loadConfigFromEnv(DEFAULT_CONFIG);
        printConfigSummary(config);

        // ─────────────────────────────────────────────────────────────────────────
        // START BOT
        // ─────────────────────────────────────────────────────────────────────────
        const bot = new PerpBot(config, exchange);

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down...');
            bot.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Shutting down...');
            bot.stop();
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
