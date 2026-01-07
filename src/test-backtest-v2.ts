// ═══════════════════════════════════════════════════════════════════════════
// BACKTEST V2 TEST SCRIPT
// Test enhanced backtester with realistic fees and slippage
// ═══════════════════════════════════════════════════════════════════════════

import { EnhancedBacktester } from './backtest-v2';
import { Candle } from './types';

// ─────────────────────────────────────────────────────────────────────────
// GENERATE SAMPLE DATA (Better than v1)
// ─────────────────────────────────────────────────────────────────────────
function generateRealisticData(days: number): Candle[] {
    const candles: Candle[] = [];
    const candlesPerDay = 96; // 15m timeframe
    const totalCandles = days * candlesPerDay;

    let price = 40000; // Starting BTC price
    const timestamp = Date.now() - (totalCandles * 15 * 60 * 1000);

    // Add regime changes (trending vs ranging)
    let trendDirection = 1;
    let trendStrength = 0.001;
    let regime = 'trending'; // 'trending' or 'ranging'
    let regimeCounter = 0;

    for (let i = 0; i < totalCandles; i++) {
        // Change regime every 500-1000 candles
        regimeCounter++;
        if (regimeCounter > 500 + Math.random() * 500) {
            regime = regime === 'trending' ? 'ranging' : 'trending';
            trendDirection = Math.random() > 0.5 ? 1 : -1;
            trendStrength = 0.0005 + Math.random() * 0.002;
            regimeCounter = 0;
        }

        // Price movement based on regime
        let change: number;
        if (regime === 'trending') {
            // Trending: consistent direction with noise
            const trend = trendDirection * trendStrength;
            const noise = (Math.random() - 0.5) * 0.002;
            change = trend + noise;
        } else {
            // Ranging: mean-reverting
            const meanReversion = -0.0002 * (price - 40000) / 40000;
            const noise = (Math.random() - 0.5) * 0.003;
            change = meanReversion + noise;
        }

        price = price * (1 + change);

        // Generate OHLC
        const volatility = regime === 'trending' ? 0.003 : 0.005;
        const high = price * (1 + Math.random() * volatility);
        const low = price * (1 - Math.random() * volatility);
        const open = price * (1 + (Math.random() - 0.5) * volatility * 0.5);
        const close = price;

        // Volume varies with volatility
        const baseVolume = 5000000;
        const volumeMultiplier = 1 + Math.abs(change) * 100;
        const volume = baseVolume * volumeMultiplier;

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
// EXTENDED EXCHANGE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────
const EXTENDED_CONFIG = {
    // Trading pair
    symbol: 'BTC',
    timeframe: '15m',
    leverage: 3,

    // Supertrend
    supertrendPeriod: 10,
    supertrendMultiplier: 3,

    // EMA
    emaFastPeriod: 50,
    emaSlowPeriod: 200,

    // ADX
    adxPeriod: 14,
    adxThreshold: 20,

    // Funding
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
        maxDailyTrades: 20,          // Extended: More trades for points
        riskRewardRatio: 1.5,
        stopLossAtrMultiplier: 1.5,
        cooldownMinutes: 5            // Short cooldown for volume
    },

    // Extended-specific fees (Starknet L2)
    fees: {
        maker: 0.0002,  // 0.02% (lower on L2)
        taker: 0.0005   // 0.05%
    },

    // Slippage model
    slippage: {
        baseSlippage: 0.0001,       // 0.01% base (L2 = better liquidity)
        volumeImpact: 0.000001,     // Very low impact on Extended
        liquidityFactor: 0.8        // Good liquidity
    },

    // Use intra-candle SL/TP
    useIntraCandleSLTP: true
};

// ─────────────────────────────────────────────────────────────────────────
// COMPARISON CONFIGS
// ─────────────────────────────────────────────────────────────────────────

// GRVT (ZKsync) - Negative maker fees!
const GRVT_CONFIG = {
    ...EXTENDED_CONFIG,
    fees: {
        maker: -0.0001,  // -0.01% (you GET PAID!)
        taker: 0.0003    // 0.03%
    },
    slippage: {
        baseSlippage: 0.00015,
        volumeImpact: 0.000002,
        liquidityFactor: 0.75
    },
    risk: {
        ...EXTENDED_CONFIG.risk,
        maxDailyTrades: 30,  // More trades = more negative fees
    }
};

// Pacifica (Solana) - Fastest
const PACIFICA_CONFIG = {
    ...EXTENDED_CONFIG,
    fees: {
        maker: 0.0003,   // 0.03%
        taker: 0.0003    // 0.03% (same for both)
    },
    slippage: {
        baseSlippage: 0.00005,    // <20ms = very low slippage
        volumeImpact: 0.0000005,
        liquidityFactor: 0.9      // Highest volume = best liquidity
    },
    risk: {
        ...EXTENDED_CONFIG.risk,
        maxDailyTrades: 50,       // High frequency on Solana
        cooldownMinutes: 1        // Almost no cooldown
    }
};

// ─────────────────────────────────────────────────────────────────────────
// RUN COMPARISON
// ─────────────────────────────────────────────────────────────────────────
async function runComparison() {
    console.log('🔬 Generating realistic market data (90 days)...\n');
    const candles = generateRealisticData(90);

    const initialEquity = 5000; // $5k starting capital

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  RUNNING BACKTEST COMPARISON: Extended vs GRVT vs Pacifica');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Extended (Starknet)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📊 [1/3] Extended (Starknet L2)\n');
    const extendedBacktest = new EnhancedBacktester(EXTENDED_CONFIG as any);
    const extendedResults = extendedBacktest.run(candles, initialEquity);
    extendedBacktest.printResults(extendedResults);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: GRVT (ZKsync)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n\n📊 [2/3] GRVT (ZKsync - Negative Maker Fees)\n');
    const grvtBacktest = new EnhancedBacktester(GRVT_CONFIG as any);
    const grvtResults = grvtBacktest.run(candles, initialEquity);
    grvtBacktest.printResults(grvtResults);

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Pacifica (Solana)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n\n📊 [3/3] Pacifica (Solana)\n');
    const pacificaBacktest = new EnhancedBacktester(PACIFICA_CONFIG as any);
    const pacificaResults = pacificaBacktest.run(candles, initialEquity);
    pacificaBacktest.printResults(pacificaResults);

    // ─────────────────────────────────────────────────────────────────────────
    // Final Comparison
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════╗');
    console.log('║                        FINAL COMPARISON                               ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════╣');

    const comparison = [
        {
            name: 'Extended',
            result: extendedResults,
            estimatedAirdrop: 12000 // $12k based on points
        },
        {
            name: 'GRVT',
            result: grvtResults,
            estimatedAirdrop: 10000 // $10k speculation
        },
        {
            name: 'Pacifica',
            result: pacificaResults,
            estimatedAirdrop: 0 // Unknown
        }
    ];

    console.log('');
    console.log('  Platform     │ Net PnL │ Fees    │ Slippage│ Airdrop │ Total ROI');
    console.log('  ─────────────┼─────────┼─────────┼─────────┼─────────┼──────────');

    for (const { name, result, estimatedAirdrop } of comparison) {
        const totalReturn = result.netPnl + estimatedAirdrop;
        const roi = (totalReturn / initialEquity) * 100;

        console.log(
            `  ${name.padEnd(12)} │ ` +
            `$${result.netPnl.toFixed(0).padStart(6)} │ ` +
            `$${result.totalFees.toFixed(0).padStart(6)} │ ` +
            `$${result.totalSlippage.toFixed(0).padStart(6)} │ ` +
            `$${estimatedAirdrop.toFixed(0).padStart(6)} │ ` +
            `${roi.toFixed(1).padStart(7)}%`
        );
    }

    console.log('  ─────────────┴─────────┴─────────┴─────────┴─────────┴──────────');
    console.log('');

    // Winner
    const winner = comparison.reduce((prev, curr) => {
        const prevTotal = prev.result.netPnl + prev.estimatedAirdrop;
        const currTotal = curr.result.netPnl + curr.estimatedAirdrop;
        return currTotal > prevTotal ? curr : prev;
    });

    const winnerTotal = winner.result.netPnl + winner.estimatedAirdrop;
    const winnerROI = (winnerTotal / initialEquity) * 100;

    console.log(`  🏆 Winner: ${winner.name}`);
    console.log(`     Total Return: $${winnerTotal.toFixed(2)} (${winnerROI.toFixed(1)}% ROI)`);
    console.log('');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');
    console.log('');

    // Recommendations
    console.log('💡 RECOMMENDATIONS:\n');
    console.log('1. Extended:');
    console.log('   ├─ Active airdrop (Season 1, ends Q1 2026)');
    console.log('   ├─ Points @ $6 OTC = most certain ROI');
    console.log('   └─ Priority: START NOW!\n');

    console.log('2. GRVT:');
    console.log('   ├─ Negative maker fees = instant profit');
    console.log('   ├─ Likely future airdrop ($10k+ potential)');
    console.log('   └─ Priority: Deploy in parallel\n');

    console.log('3. Pacifica:');
    console.log('   ├─ Best for pure trading profit (lowest latency)');
    console.log('   ├─ Airdrop uncertain (no token yet)');
    console.log('   └─ Priority: Lower (use excess capital)\n');

    console.log('📊 Capital Allocation ($5,000):');
    console.log('   ├─ Extended:  $2,000 (40%) - Airdrop farming');
    console.log('   ├─ GRVT:      $2,000 (40%) - Negative fees + airdrop');
    console.log('   └─ Pacifica:  $1,000 (20%) - Scalping profit');
    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────
runComparison().catch(console.error);
