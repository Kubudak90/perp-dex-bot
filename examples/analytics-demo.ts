// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS SERVICE DEMO
// Example usage of performance analytics and metrics
// ═══════════════════════════════════════════════════════════════════════════

import { AnalyticsService } from '../src/utils/analytics';
import { TradeResult } from '../src/types';

function main() {
    const analytics = new AnalyticsService();

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 1: Sample Trading History
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📊 Generating sample trading history...\n');

    const sampleTrades: TradeResult[] = [
        // Week 1 - Mixed results
        { side: 'LONG', entryPrice: 40000, exitPrice: 40800, pnl: 400, pnlPercent: 4.0, duration: 3600000 * 3, exitReason: 'TP' },
        { side: 'SHORT', entryPrice: 41000, exitPrice: 40500, pnl: 250, pnlPercent: 2.5, duration: 3600000 * 2, exitReason: 'TP' },
        { side: 'LONG', entryPrice: 40300, exitPrice: 39900, pnl: -200, pnlPercent: -2.0, duration: 3600000 * 1, exitReason: 'SL' },

        // Week 2 - Winning streak
        { side: 'SHORT', entryPrice: 41500, exitPrice: 41000, pnl: 500, pnlPercent: 5.0, duration: 3600000 * 4, exitReason: 'TP' },
        { side: 'LONG', entryPrice: 40800, exitPrice: 41400, pnl: 300, pnlPercent: 3.0, duration: 3600000 * 2.5, exitReason: 'TP' },
        { side: 'SHORT', entryPrice: 42000, exitPrice: 41600, pnl: 200, pnlPercent: 2.0, duration: 3600000 * 3, exitReason: 'TP' },

        // Week 3 - Losing streak
        { side: 'LONG', entryPrice: 41000, exitPrice: 40700, pnl: -150, pnlPercent: -1.5, duration: 3600000 * 0.5, exitReason: 'SL' },
        { side: 'SHORT', entryPrice: 40500, exitPrice: 40800, pnl: -150, pnlPercent: -1.5, duration: 3600000 * 1, exitReason: 'SL' },
        { side: 'LONG', entryPrice: 40200, exitPrice: 40000, pnl: -100, pnlPercent: -1.0, duration: 3600000 * 0.75, exitReason: 'SIGNAL' },

        // Week 4 - Recovery
        { side: 'SHORT', entryPrice: 41800, exitPrice: 41200, pnl: 600, pnlPercent: 6.0, duration: 3600000 * 5, exitReason: 'TP' },
        { side: 'LONG', entryPrice: 40900, exitPrice: 41500, pnl: 300, pnlPercent: 3.0, duration: 3600000 * 2, exitReason: 'TP' },
        { side: 'SHORT', entryPrice: 42200, exitPrice: 41900, pnl: 150, pnlPercent: 1.5, duration: 3600000 * 1.5, exitReason: 'TP' },
    ];

    const initialEquity = 10000;

    console.log('  Sample Trades:');
    for (let i = 0; i < sampleTrades.length; i++) {
        const trade = sampleTrades[i];
        const emoji = trade.pnl >= 0 ? '✅' : '❌';
        console.log(
            `    ${i + 1}. ${emoji} ${trade.side.padEnd(5)} | ` +
            `$${trade.entryPrice} → $${trade.exitPrice} | ` +
            `PnL: $${trade.pnl.toFixed(2)} (${trade.pnlPercent}%) | ` +
            `${trade.exitReason}`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 2: Calculate Performance Statistics
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📈 Calculating performance statistics...\n');

    const stats = analytics.calculatePerformanceStats(sampleTrades, initialEquity);

    console.log(analytics.formatStats(stats));

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 3: Equity Curve
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📊 Equity curve:\n');

    const equityCurve = analytics.calculateEquityCurve(sampleTrades, initialEquity);

    console.log('  Time                     | Equity    | Change    | Drawdown');
    console.log('  ' + '─'.repeat(65));

    for (const point of equityCurve) {
        const date = new Date(point.timestamp).toLocaleDateString();
        const changeEmoji = point.equity >= initialEquity ? '📈' : '📉';
        const change = point.equity - initialEquity;
        const drawdownStr = point.drawdown > 0 ? `-$${point.drawdown.toFixed(2)}` : '$0';

        console.log(
            `  ${date.padEnd(24)} | ` +
            `$${point.equity.toFixed(2).padStart(8)} | ` +
            `${changeEmoji} $${change.toFixed(2).padStart(7)} | ` +
            `${drawdownStr.padStart(8)}`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 4: Strategy Insights
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n💡 Strategy insights:\n');

    const insights = analyzeStrategy(stats);
    for (const insight of insights) {
        console.log(`  ${insight}`);
    }

    console.log('\n🎉 Analytics demo completed!');
}

// Helper function to generate strategy insights
function analyzeStrategy(stats: any): string[] {
    const insights: string[] = [];

    // Win rate analysis
    if (stats.winRate >= 60) {
        insights.push('✅ Strong win rate (>60%) - Strategy is performing well');
    } else if (stats.winRate >= 50) {
        insights.push('⚠️  Moderate win rate (50-60%) - Consider tightening entry conditions');
    } else {
        insights.push('❌ Low win rate (<50%) - Strategy needs improvement');
    }

    // Risk metrics
    if (stats.sharpeRatio >= 2) {
        insights.push('✅ Excellent Sharpe ratio (>2) - Strong risk-adjusted returns');
    } else if (stats.sharpeRatio >= 1) {
        insights.push('⚠️  Moderate Sharpe ratio (1-2) - Acceptable risk-adjusted returns');
    } else {
        insights.push('❌ Low Sharpe ratio (<1) - Poor risk-adjusted returns');
    }

    // Drawdown
    if (stats.maxDrawdownPercent <= 10) {
        insights.push('✅ Low drawdown (<10%) - Good risk management');
    } else if (stats.maxDrawdownPercent <= 20) {
        insights.push('⚠️  Moderate drawdown (10-20%) - Monitor risk closely');
    } else {
        insights.push('❌ High drawdown (>20%) - Risk management needs improvement');
    }

    // Current streak
    if (stats.currentStreak.type === 'win' && stats.currentStreak.count >= 3) {
        insights.push(`🔥 Hot streak! ${stats.currentStreak.count} consecutive wins - Stay disciplined`);
    } else if (stats.currentStreak.type === 'loss' && stats.currentStreak.count >= 3) {
        insights.push(`❄️  Cold streak: ${stats.currentStreak.count} consecutive losses - Consider reducing position size`);
    }

    // Exit reasons
    const exitReasonBreakdown = stats.exitReasonBreakdown;
    const tpCount = exitReasonBreakdown['TP'] || 0;
    const slCount = exitReasonBreakdown['SL'] || 0;

    if (tpCount > slCount * 1.5) {
        insights.push('✅ Taking profits effectively - More TP exits than SL');
    } else if (slCount > tpCount) {
        insights.push('⚠️  Frequent stop losses - Consider wider stops or better entries');
    }

    return insights;
}

main();
