// ═══════════════════════════════════════════════════════════════════════════
// BACKTEST WITH OPTIMIZED STRATEGY
// Test different parameter combinations to find optimal settings
// ═══════════════════════════════════════════════════════════════════════════

import { EnhancedBacktester } from './backtest-v2';
import { Candle } from './types';

// ─────────────────────────────────────────────────────────────────────────
// GENERATE MORE REALISTIC DATA (Based on actual BTC patterns)
// ─────────────────────────────────────────────────────────────────────────
function generateRealisticBTCData(days: number): Candle[] {
    const candles: Candle[] = [];
    const candlesPerDay = 96; // 15m timeframe
    const totalCandles = days * candlesPerDay;

    // Start from a realistic BTC price (Oct 2025 - Jan 2026)
    let price = 67000;
    const timestamp = Date.now() - (totalCandles * 15 * 60 * 1000);

    // Market regime parameters
    let trendDirection = 1;      // 1 = up, -1 = down
    let trendStrength = 0.0015;  // Daily drift
    let volatility = 0.003;      // Base volatility
    let regime = 'trending';     // 'trending' or 'ranging' or 'choppy'
    let regimeCounter = 0;

    for (let i = 0; i < totalCandles; i++) {
        // Change regime every 300-800 candles (~3-8 days)
        regimeCounter++;
        if (regimeCounter > 300 + Math.random() * 500) {
            const rand = Math.random();
            if (rand < 0.4) {
                regime = 'trending';
                trendDirection = Math.random() > 0.5 ? 1 : -1;
                trendStrength = 0.001 + Math.random() * 0.002;
                volatility = 0.002 + Math.random() * 0.002;
            } else if (rand < 0.7) {
                regime = 'ranging';
                trendStrength = 0;
                volatility = 0.003 + Math.random() * 0.003;
            } else {
                regime = 'choppy';
                trendStrength = 0;
                volatility = 0.005 + Math.random() * 0.005;
            }
            regimeCounter = 0;
        }

        // Price movement based on regime
        let change: number;
        if (regime === 'trending') {
            // Trending: persistent direction with occasional pullbacks
            const trend = trendDirection * trendStrength;
            const noise = (Math.random() - 0.5) * volatility;
            // Occasional strong moves (momentum)
            const momentum = Math.random() < 0.05 ? trendDirection * 0.01 : 0;
            change = trend + noise + momentum;
        } else if (regime === 'ranging') {
            // Ranging: mean-reverting around a level
            const distance = (price - 67000) / 67000; // Distance from anchor
            const meanReversion = -distance * 0.002;
            const noise = (Math.random() - 0.5) * volatility;
            change = meanReversion + noise;
        } else {
            // Choppy: high volatility, no clear direction
            change = (Math.random() - 0.5) * volatility * 2;
        }

        price = price * (1 + change);

        // Ensure price doesn't go too low (realistic constraint)
        price = Math.max(price, 30000);

        // Generate OHLC with realistic intra-candle behavior
        const range = price * volatility * (0.5 + Math.random());
        const highOffset = range * (0.3 + Math.random() * 0.7);
        const lowOffset = range * (0.3 + Math.random() * 0.7);

        const high = price + highOffset;
        const low = price - lowOffset;
        const open = low + (high - low) * Math.random();
        const close = price;

        // Volume varies with volatility and momentum
        const baseVolume = 5000000;
        const volMultiplier = 1 + Math.abs(change) * 200 + (regime === 'choppy' ? 0.5 : 0);
        const volume = baseVolume * volMultiplier * (0.8 + Math.random() * 0.4);

        candles.push({
            timestamp: timestamp + (i * 15 * 60 * 1000),
            open: Math.max(low, Math.min(high, open)),
            high,
            low,
            close,
            volume
        });
    }

    return candles;
}

// ─────────────────────────────────────────────────────────────────────────
// PARAMETER OPTIMIZATION
// Test different strategy parameters
// ─────────────────────────────────────────────────────────────────────────
interface ParameterSet {
    name: string;
    supertrendPeriod: number;
    supertrendMultiplier: number;
    emaFastPeriod: number;
    emaSlowPeriod: number;
    adxThreshold: number;
    stopLossAtrMultiplier: number;
    riskRewardRatio: number;
}

const PARAMETER_SETS: ParameterSet[] = [
    {
        name: 'Default (Conservative)',
        supertrendPeriod: 10,
        supertrendMultiplier: 3,
        emaFastPeriod: 50,
        emaSlowPeriod: 200,
        adxThreshold: 20,
        stopLossAtrMultiplier: 1.5,
        riskRewardRatio: 1.5
    },
    {
        name: 'Aggressive',
        supertrendPeriod: 7,
        supertrendMultiplier: 2.5,
        emaFastPeriod: 20,
        emaSlowPeriod: 100,
        adxThreshold: 15,
        stopLossAtrMultiplier: 1.0,
        riskRewardRatio: 2.0
    },
    {
        name: 'Tight SL (Volume Farming)',
        supertrendPeriod: 10,
        supertrendMultiplier: 3,
        emaFastPeriod: 50,
        emaSlowPeriod: 200,
        adxThreshold: 18,
        stopLossAtrMultiplier: 1.0,  // Tighter SL = more trades
        riskRewardRatio: 1.2
    },
    {
        name: 'Wide SL (Profit Focus)',
        supertrendPeriod: 12,
        supertrendMultiplier: 3.5,
        emaFastPeriod: 50,
        emaSlowPeriod: 200,
        adxThreshold: 22,
        stopLossAtrMultiplier: 2.0,  // Wider SL = less trades, higher win rate
        riskRewardRatio: 2.0
    },
    {
        name: 'Fast EMA (Trend Responsive)',
        supertrendPeriod: 10,
        supertrendMultiplier: 3,
        emaFastPeriod: 30,
        emaSlowPeriod: 100,
        adxThreshold: 20,
        stopLossAtrMultiplier: 1.5,
        riskRewardRatio: 1.5
    }
];

// ─────────────────────────────────────────────────────────────────────────
// RUN PARAMETER OPTIMIZATION
// ─────────────────────────────────────────────────────────────────────────
async function runOptimization() {
    console.log('🔬 Generating realistic BTC market data (90 days)...\n');
    const candles = generateRealisticBTCData(90);

    const initialEquity = 5000;

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  STRATEGY PARAMETER OPTIMIZATION');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const results: any[] = [];

    for (let i = 0; i < PARAMETER_SETS.length; i++) {
        const params = PARAMETER_SETS[i];

        console.log(`\n📊 [${i + 1}/${PARAMETER_SETS.length}] Testing: ${params.name}\n`);

        const config = {
            symbol: 'BTC',
            timeframe: '15m',
            leverage: 3,

            supertrendPeriod: params.supertrendPeriod,
            supertrendMultiplier: params.supertrendMultiplier,

            emaFastPeriod: params.emaFastPeriod,
            emaSlowPeriod: params.emaSlowPeriod,

            adxPeriod: 14,
            adxThreshold: params.adxThreshold,

            fundingThreshold: 0.0005,
            useFundingFilter: true,

            atrPeriod: 14,
            atrLookback: 100,
            minAtrPercentile: 20,
            maxAtrPercentile: 90,

            risk: {
                maxPositionSize: 20,
                maxDailyLoss: 3,
                maxDailyTrades: 20,
                riskRewardRatio: params.riskRewardRatio,
                stopLossAtrMultiplier: params.stopLossAtrMultiplier,
                cooldownMinutes: 5
            },

            fees: {
                maker: 0.0002,
                taker: 0.0005
            },

            slippage: {
                baseSlippage: 0.0001,
                volumeImpact: 0.000001,
                liquidityFactor: 0.8
            },

            useIntraCandleSLTP: true
        };

        const backtester = new EnhancedBacktester(config as any);
        const result = backtester.run(candles, initialEquity);

        results.push({
            name: params.name,
            result,
            params
        });

        // Print summary
        console.log(`\n  ✅ ${params.name}:`);
        console.log(`     Net PnL:      $${result.netPnl.toFixed(2)} (${result.totalPnlPercent.toFixed(1)}%)`);
        console.log(`     Win Rate:     ${result.winRate.toFixed(1)}%`);
        console.log(`     Total Trades: ${result.totalTrades}`);
        console.log(`     Sharpe:       ${result.sharpeRatio.toFixed(2)}`);
        console.log(`     Max DD:       $${result.maxDrawdown.toFixed(2)} (${result.maxDrawdownPercent.toFixed(2)}%)`);
        console.log(`     Profit Factor: ${result.profitFactor.toFixed(2)}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Final Comparison
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                        OPTIMIZATION RESULTS                           ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════╣');
    console.log('');
    console.log('  Strategy                │ ROI    │ Trades│ WinRate│ Sharpe│ PF    │ MaxDD%');
    console.log('  ────────────────────────┼────────┼───────┼────────┼───────┼───────┼───────');

    for (const { name, result } of results) {
        console.log(
            `  ${name.padEnd(23)} │ ` +
            `${result.totalPnlPercent.toFixed(1).padStart(6)}%│ ` +
            `${String(result.totalTrades).padStart(6)} │ ` +
            `${result.winRate.toFixed(1).padStart(6)}%│ ` +
            `${result.sharpeRatio.toFixed(2).padStart(6)} │ ` +
            `${result.profitFactor.toFixed(2).padStart(6)} │ ` +
            `${result.maxDrawdownPercent.toFixed(1).padStart(6)}%`
        );
    }

    console.log('  ────────────────────────┴────────┴───────┴────────┴───────┴───────┴───────');
    console.log('');

    // Find best by different criteria
    const bestROI = results.reduce((prev, curr) =>
        curr.result.totalPnlPercent > prev.result.totalPnlPercent ? curr : prev
    );

    const bestSharpe = results.reduce((prev, curr) =>
        curr.result.sharpeRatio > prev.result.sharpeRatio ? curr : prev
    );

    const bestWinRate = results.reduce((prev, curr) =>
        curr.result.winRate > prev.result.winRate ? curr : prev
    );

    const mostTrades = results.reduce((prev, curr) =>
        curr.result.totalTrades > prev.result.totalTrades ? curr : prev
    );

    console.log('  🏆 Best ROI:              ' + bestROI.name);
    console.log('  📊 Best Sharpe:           ' + bestSharpe.name);
    console.log('  ✅ Best Win Rate:         ' + bestWinRate.name);
    console.log('  🔥 Most Trades (Volume):  ' + mostTrades.name);
    console.log('');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log('');

    // Recommendations
    console.log('💡 RECOMMENDATIONS:\n');
    console.log('For PROFIT (live trading):');
    console.log(`  → Use "${bestSharpe.name}" (Best risk-adjusted returns)`);
    console.log(`     Sharpe: ${bestSharpe.result.sharpeRatio.toFixed(2)}, ROI: ${bestSharpe.result.totalPnlPercent.toFixed(1)}%\n`);

    console.log('For AIRDROP FARMING (Extended):');
    console.log(`  → Use "${mostTrades.name}" (Maximum volume generation)`);
    console.log(`     Trades: ${mostTrades.result.totalTrades}, ROI: ${mostTrades.result.totalPnlPercent.toFixed(1)}%\n`);

    console.log('For BALANCED:');
    console.log(`  → Use "Default (Conservative)" (Good risk/reward balance)`);
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────
runOptimization().catch(console.error);
