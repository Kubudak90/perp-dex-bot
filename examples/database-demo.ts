// ═══════════════════════════════════════════════════════════════════════════
// DATABASE SERVICE DEMO
// Example usage of SQLite trade history database
// ═══════════════════════════════════════════════════════════════════════════

import { DatabaseService } from '../src/utils/database';
import { Logger } from '../src/utils/logger';
import { TradeResult } from '../src/types';

async function main() {
    const logger = new Logger('DatabaseDemo');

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP
    // ─────────────────────────────────────────────────────────────────────────
    console.log('🗄️  Initializing database...\n');
    const db = new DatabaseService('./data/demo-trades.db', logger);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 1: Save Trades
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📝 Saving sample trades...\n');

    const sampleTrades: TradeResult[] = [
        {
            side: 'LONG',
            entryPrice: 42000,
            exitPrice: 42800,
            pnl: 400,
            pnlPercent: 4.0,
            duration: 3600000 * 3, // 3 hours
            exitReason: 'TP'
        },
        {
            side: 'SHORT',
            entryPrice: 43000,
            exitPrice: 42500,
            pnl: 250,
            pnlPercent: 2.5,
            duration: 3600000 * 1.5,
            exitReason: 'TP'
        },
        {
            side: 'LONG',
            entryPrice: 41800,
            exitPrice: 41200,
            pnl: -300,
            pnlPercent: -3.0,
            duration: 3600000 * 0.5,
            exitReason: 'SL'
        },
        {
            side: 'SHORT',
            entryPrice: 42200,
            exitPrice: 42100,
            pnl: 50,
            pnlPercent: 0.5,
            duration: 3600000 * 2,
            exitReason: 'SIGNAL'
        },
        {
            side: 'LONG',
            entryPrice: 42500,
            exitPrice: 43500,
            pnl: 500,
            pnlPercent: 5.0,
            duration: 3600000 * 4,
            exitReason: 'TP'
        }
    ];

    let equity = 10000;
    let dailyPnl = 0;

    for (const trade of sampleTrades) {
        db.saveTrade(trade, 'BTC', 3, 0.5, equity, dailyPnl);
        equity += trade.pnl;
        dailyPnl += trade.pnl;
        console.log(
            `  ✅ ${trade.side.padEnd(5)} | ` +
            `Entry: $${trade.entryPrice} | ` +
            `Exit: $${trade.exitPrice} | ` +
            `PnL: $${trade.pnl} (${trade.pnlPercent}%)`
        );
    }

    console.log(`\n💰 Final equity: $${equity}\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 2: Query Trades
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📊 Querying trades...\n');

    const allTrades = db.getTrades(100);
    console.log(`  Total trades in database: ${allTrades.length}`);

    const recentTrades = db.getTrades(3);
    console.log(`  Recent trades (last 3):`);
    for (const trade of recentTrades) {
        const emoji = trade.pnl > 0 ? '✅' : '❌';
        console.log(
            `    ${emoji} [${new Date(trade.timestamp).toLocaleString()}] ` +
            `${trade.side} @ $${trade.entry_price} → $${trade.exit_price} | ` +
            `PnL: $${trade.pnl}`
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 3: Performance Metrics
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📈 Performance metrics:\n');

    const metrics = db.calculatePerformanceMetrics();
    console.log(`  Total Trades:    ${metrics.totalTrades}`);
    console.log(`  Win Rate:        ${metrics.winRate.toFixed(1)}%`);
    console.log(`  Total PnL:       $${metrics.totalPnl.toFixed(2)}`);
    console.log(`  Avg Win:         $${metrics.avgWin.toFixed(2)}`);
    console.log(`  Avg Loss:        $${metrics.avgLoss.toFixed(2)}`);
    console.log(`  Largest Win:     $${metrics.largestWin.toFixed(2)}`);
    console.log(`  Largest Loss:    $${metrics.largestLoss.toFixed(2)}`);
    console.log(`  Max Drawdown:    $${metrics.maxDrawdown.toFixed(2)}`);
    console.log(`  Current Streak:  ${metrics.currentStreak.count} ${metrics.currentStreak.type}`);

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 4: State Snapshots
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n💾 Saving state snapshot...\n');

    const mockState = {
        position: null,
        dailyPnl: dailyPnl,
        dailyTrades: sampleTrades.length,
        lastTradeTime: Date.now(),
        lastLossTime: 0,
        isActive: true,
        equity: equity,
        trades: sampleTrades
    };

    db.saveStateSnapshot(mockState);
    console.log('  ✅ State snapshot saved');

    // ─────────────────────────────────────────────────────────────────────────
    // EXAMPLE 5: Export to CSV
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n📤 Exporting trades to CSV...\n');

    const csvPath = './data/demo-trades-export.csv';
    db.exportToCSV(csvPath);
    console.log(`  ✅ Trades exported to: ${csvPath}`);

    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    db.close();
    console.log('\n🎉 Database demo completed!');
    console.log('\n💡 TIP: Check ./data/demo-trades.db to see the SQLite database');
}

main().catch(console.error);
