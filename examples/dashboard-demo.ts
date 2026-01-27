// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD DEMO
// Demonstrates the terminal dashboard with simulated data
// ═══════════════════════════════════════════════════════════════════════════

import { Dashboard } from '../src/utils/dashboard';
import { BotState, BotConfig, Indicators } from '../src/types';

// Create dashboard instance
const dashboard = new Dashboard();

// Sample config
const config: BotConfig = {
    symbol: 'BTC-PERP',
    timeframe: '15m',
    leverage: 5,
    supertrendPeriod: 10,
    supertrendMultiplier: 3,
    emaFastPeriod: 50,
    emaSlowPeriod: 200,
    adxPeriod: 14,
    adxThreshold: 20,
    atrPeriod: 14,
    atrLookback: 100,
    minAtrPercentile: 20,
    maxAtrPercentile: 90,
    fundingThreshold: 0.0005,
    risk: {
        maxPositionSize: 20,
        maxDailyLoss: 3,
        riskRewardRatio: 1.5,
        riskPerTrade: 1,
        cooldownMinutes: 30
    }
};

// Simulated state
let state: BotState = {
    isRunning: true,
    hasPosition: false,
    currentPosition: null,
    lastSignal: 'NONE',
    dailyPnl: 0,
    dailyTrades: 0,
    equity: 10000,
    lastError: null,
    startTime: Date.now() - 3600000, // 1 hour ago
    lastUpdate: Date.now()
};

// Simulated indicators
let indicators: Indicators = {
    supertrend: {
        value: 42150,
        direction: 1
    },
    emaFast: 42300,
    emaSlow: 42100,
    adx: {
        adx: 28.5,
        plusDI: 32.1,
        minusDI: 18.4
    },
    atr: {
        value: 450,
        percentile: 45
    },
    funding: {
        rate: 0.0003,
        nextFundingTime: Date.now() + 3600000
    }
};

let currentPrice = 42350;

// Simulation functions
function simulateMarket(): void {
    // Random price movement
    const change = (Math.random() - 0.5) * 100;
    currentPrice += change;

    // Update indicators
    indicators.supertrend.value = currentPrice - 200 + Math.random() * 50;
    indicators.supertrend.direction = currentPrice > indicators.supertrend.value ? 1 : -1;
    indicators.emaFast = currentPrice - 50 + Math.random() * 100;
    indicators.emaSlow = currentPrice - 200 + Math.random() * 100;
    indicators.adx.adx = 20 + Math.random() * 20;
    indicators.adx.plusDI = 20 + Math.random() * 20;
    indicators.adx.minusDI = 15 + Math.random() * 15;
    indicators.atr.value = 400 + Math.random() * 100;
    indicators.atr.percentile = 30 + Math.random() * 40;
    indicators.funding.rate = (Math.random() - 0.5) * 0.001;

    // Simulate trades occasionally
    if (Math.random() < 0.05 && !state.hasPosition) {
        // Open position
        const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';
        state.hasPosition = true;
        state.currentPosition = {
            side,
            entryPrice: currentPrice,
            size: 0.1,
            stopLoss: side === 'LONG' ? currentPrice - 500 : currentPrice + 500,
            takeProfit: side === 'LONG' ? currentPrice + 750 : currentPrice - 750,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            initialSize: 0.1,
            remainingSize: 0.1,
            partialTpLevels: []
        };
        state.lastSignal = side;
    } else if (state.hasPosition && state.currentPosition) {
        // Update unrealized PnL
        const pnlMultiplier = state.currentPosition.side === 'LONG' ? 1 : -1;
        state.currentPosition.unrealizedPnl =
            (currentPrice - state.currentPosition.entryPrice) *
            state.currentPosition.size *
            pnlMultiplier *
            config.leverage;

        // Close position occasionally
        if (Math.random() < 0.03) {
            const pnl = state.currentPosition.unrealizedPnl;
            state.dailyPnl += pnl;
            state.dailyTrades++;
            state.equity += pnl;
            state.hasPosition = false;
            state.currentPosition = null;
            state.lastSignal = 'NONE';
        }
    }

    state.lastUpdate = Date.now();
}

// Main loop
console.log('\n🎯 Dashboard Demo - Press Ctrl+C to exit\n');

// Update dashboard every second
setInterval(() => {
    simulateMarket();
    dashboard.updateIndicators(indicators, currentPrice);
    dashboard.render(state);
}, 1000);

// Handle exit
process.on('SIGINT', () => {
    console.clear();
    console.log('\n👋 Dashboard demo stopped.\n');
    process.exit(0);
});
