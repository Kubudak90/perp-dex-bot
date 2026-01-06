// ═══════════════════════════════════════════════════════════════════════════
// BINANCE DATA BACKTEST
// Run backtest on real Binance historical data
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { Candle, BotConfig } from './types';
import { Backtester } from './backtest';

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG (same as main bot)
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
// MAIN
// ─────────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║              BINANCE DATA BACKTEST                                    ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);

    // Get period from command line argument (30, 60, or 90 days)
    const period = parseInt(process.argv[2] || '30');

    if (![30, 60, 90].includes(period)) {
        console.error('❌ Invalid period. Use: 30, 60, or 90');
        process.exit(1);
    }

    const dataFile = `src/data/binance-btc-15m-${period}d.json`;

    console.log(`📊 Loading ${period}-day Binance data...`);
    console.log(`   File: ${dataFile}\n`);

    let candles: Candle[];

    try {
        const data = readFileSync(dataFile, 'utf-8');
        candles = JSON.parse(data);

        console.log(`✅ Loaded ${candles.length} candles`);

        const firstDate = new Date(candles[0].timestamp).toISOString();
        const lastDate = new Date(candles[candles.length - 1].timestamp).toISOString();

        console.log(`   Period: ${firstDate} → ${lastDate}`);
        console.log(`   Symbol: BTCUSDT`);
        console.log(`   Timeframe: 15m\n`);

    } catch (error: any) {
        console.error(`❌ Failed to load data file: ${dataFile}`);
        console.error(`   ${error.message}\n`);
        console.error('Please run: npm run fetch:binance');
        console.error('Or manually place Binance data in the file.\n');
        process.exit(1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DISPLAY MARKET CONDITIONS
    // ─────────────────────────────────────────────────────────────────────────
    const firstPrice = candles[0].close;
    const lastPrice = candles[candles.length - 1].close;
    const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
    const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;

    console.log('─────────────────────────────────────────────────────────────');
    console.log('MARKET CONDITIONS');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Start Price: $${firstPrice.toFixed(2)}`);
    console.log(`End Price: $${lastPrice.toFixed(2)}`);
    console.log(`Change: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
    console.log(`Avg Volume: $${avgVolume.toLocaleString()}`);
    console.log('');

    // ─────────────────────────────────────────────────────────────────────────
    // RUN BACKTEST
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────');
    console.log('STRATEGY CONFIGURATION');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Supertrend: Period=${DEFAULT_CONFIG.supertrendPeriod}, Multiplier=${DEFAULT_CONFIG.supertrendMultiplier}`);
    console.log(`EMA: Fast=${DEFAULT_CONFIG.emaFastPeriod}, Slow=${DEFAULT_CONFIG.emaSlowPeriod}`);
    console.log(`ADX: Period=${DEFAULT_CONFIG.adxPeriod}, Threshold=${DEFAULT_CONFIG.adxThreshold}`);
    console.log(`Funding Filter: ${DEFAULT_CONFIG.useFundingFilter ? 'Enabled' : 'Disabled'} (${(DEFAULT_CONFIG.fundingThreshold * 100).toFixed(2)}%)`);
    console.log(`ATR Percentile: ${DEFAULT_CONFIG.minAtrPercentile}% - ${DEFAULT_CONFIG.maxAtrPercentile}%`);
    console.log(`Leverage: ${DEFAULT_CONFIG.leverage}x`);
    console.log(`Risk/Reward: 1:${DEFAULT_CONFIG.risk.riskRewardRatio}`);
    console.log(`Stop Loss: ${DEFAULT_CONFIG.risk.stopLossAtrMultiplier}x ATR`);
    console.log('');

    const initialEquity = 10000;
    const backtester = new Backtester(DEFAULT_CONFIG);

    console.log('─────────────────────────────────────────────────────────────');
    console.log('RUNNING BACKTEST...');
    console.log('─────────────────────────────────────────────────────────────\n');

    const result = backtester.run(candles, initialEquity);

    // ─────────────────────────────────────────────────────────────────────────
    // DISPLAY RESULTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                     BACKTEST RESULTS                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

    console.log('─────────────────────────────────────────────────────────────');
    console.log('PERFORMANCE METRICS');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Initial Equity: $${initialEquity.toFixed(2)}`);
    console.log(`Final Equity: $${(initialEquity + result.totalPnl).toFixed(2)}`);
    console.log(`Total PnL: $${result.totalPnl.toFixed(2)} (${result.totalPnlPercent >= 0 ? '+' : ''}${result.totalPnlPercent.toFixed(2)}%)`);
    console.log(`Max Drawdown: $${result.maxDrawdown.toFixed(2)} (${result.maxDrawdownPercent.toFixed(2)}%)`);
    console.log('');

    console.log('─────────────────────────────────────────────────────────────');
    console.log('TRADE STATISTICS');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Total Trades: ${result.totalTrades}`);
    console.log(`Winning Trades: ${result.winningTrades} (${result.winRate.toFixed(1)}%)`);
    console.log(`Losing Trades: ${result.losingTrades} (${(100 - result.winRate).toFixed(1)}%)`);
    console.log(`Profit Factor: ${result.profitFactor.toFixed(2)}`);
    console.log(`Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
    console.log('');

    console.log('─────────────────────────────────────────────────────────────');
    console.log('TRADE DETAILS');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`Average Win: $${result.averageWin.toFixed(2)}`);
    console.log(`Average Loss: $${result.averageLoss.toFixed(2)}`);
    console.log(`Largest Win: $${result.largestWin.toFixed(2)}`);
    console.log(`Largest Loss: $${result.largestLoss.toFixed(2)}`);
    console.log(`Avg Trade Duration: ${result.averageTradeDuration.toFixed(1)} minutes`);
    console.log('');

    // ─────────────────────────────────────────────────────────────────────────
    // TRADE-BY-TRADE ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────────');
    console.log('TRADE HISTORY');
    console.log('─────────────────────────────────────────────────────────────');

    if (result.trades.length > 0) {
        console.log(`\nShowing all ${result.trades.length} trades:\n`);

        result.trades.forEach((trade, i) => {
            const entryDate = new Date(trade.entryTime).toISOString().split('T')[0];
            const exitDate = new Date(trade.exitTime).toISOString().split('T')[0];
            const duration = ((trade.exitTime - trade.entryTime) / 1000 / 60).toFixed(0);
            const outcome = trade.pnl >= 0 ? '✅' : '❌';

            console.log(`${i + 1}. ${outcome} ${trade.side} | ${entryDate} → ${exitDate}`);
            console.log(`   Entry: $${trade.entryPrice.toFixed(2)} | Exit: $${trade.exitPrice.toFixed(2)}`);
            console.log(`   PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%) | ${trade.exitReason}`);
            console.log(`   Duration: ${duration}m | Size: ${trade.size.toFixed(4)}`);
            console.log('');
        });
    } else {
        console.log('\n⚠️  No trades executed during backtest period\n');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY AND RECOMMENDATIONS
    // ─────────────────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('ANALYSIS SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Performance evaluation
    if (result.totalPnlPercent < -10) {
        console.log('🔴 POOR PERFORMANCE (-10% or worse)');
        console.log('   Strategy is losing money consistently.');
        console.log('   Recommendations:');
        console.log('   - Review entry/exit conditions');
        console.log('   - Increase ADX threshold (reduce false signals)');
        console.log('   - Tighten ATR percentile range');
        console.log('   - Consider market regime changes\n');
    } else if (result.totalPnlPercent < 0) {
        console.log('🟡 NEGATIVE PERFORMANCE');
        console.log('   Strategy needs optimization.');
        console.log('   Recommendations:');
        console.log('   - Adjust parameters for current market');
        console.log('   - Review losing trades for patterns');
        console.log('   - Consider adding filters\n');
    } else if (result.totalPnlPercent < 10) {
        console.log('🟡 MODEST POSITIVE PERFORMANCE');
        console.log('   Strategy is profitable but could be improved.');
        console.log('   Recommendations:');
        console.log('   - Fine-tune risk management');
        console.log('   - Review trade timing');
        console.log('   - Consider parameter optimization\n');
    } else {
        console.log('🟢 GOOD PERFORMANCE');
        console.log('   Strategy is performing well on this data.');
        console.log('   Recommendations:');
        console.log('   - Validate on other time periods');
        console.log('   - Test with different market conditions');
        console.log('   - Monitor for overfitting\n');
    }

    // Win rate evaluation
    if (result.winRate < 40) {
        console.log('⚠️  LOW WIN RATE (<40%)');
        console.log('   Too many losing trades (whipsaw problem).');
        console.log('   Solutions:');
        console.log('   - Increase ADX threshold (25+)');
        console.log('   - Add trend confirmation filters');
        console.log('   - Widen stop loss (2x ATR)\n');
    }

    // Drawdown evaluation
    if (result.maxDrawdownPercent > 20) {
        console.log('⚠️  HIGH DRAWDOWN (>20%)');
        console.log('   Risk exposure is too high.');
        console.log('   Solutions:');
        console.log('   - Reduce position size');
        console.log('   - Lower leverage');
        console.log('   - Implement stricter daily loss limits\n');
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch((error) => {
    console.error('\n❌ Backtest failed:', error);
    process.exit(1);
});
