// ═══════════════════════════════════════════════════════════════════════════
// DATABASE SERVICE
// SQLite database for trade history and performance tracking
// ═══════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { Logger } from './logger';
import { TradeResult, BotState } from '../types';
import * as path from 'path';

export interface TradeRecord {
    id: number;
    timestamp: number;
    symbol: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    size: number;
    pnl: number;
    pnlPercent: number;
    duration: number;
    exitReason: string;
    leverage: number;
    fees?: number;
    slippage?: number;
}

export interface PerformanceMetrics {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;
    averageDuration: number;
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
}

// ─────────────────────────────────────────────────────────────────────────
// DATABASE SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class DatabaseService {
    private db: Database.Database;
    private logger: Logger;

    constructor(dbPath: string = './data/trades.db') {
        this.logger = new Logger('Database');

        // Ensure directory exists
        const dir = path.dirname(dbPath);
        try {
            require('fs').mkdirSync(dir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }

        this.db = new Database(dbPath);
        this.initializeTables();
        this.logger.info(`Database initialized at ${dbPath}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZE TABLES
    // ─────────────────────────────────────────────────────────────────────────
    private initializeTables(): void {
        // Trades table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                entry_price REAL NOT NULL,
                exit_price REAL NOT NULL,
                size REAL NOT NULL,
                pnl REAL NOT NULL,
                pnl_percent REAL NOT NULL,
                duration INTEGER NOT NULL,
                exit_reason TEXT NOT NULL,
                leverage INTEGER NOT NULL,
                fees REAL,
                slippage REAL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
            CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
        `);

        // Daily stats table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS daily_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                total_trades INTEGER NOT NULL,
                winning_trades INTEGER NOT NULL,
                losing_trades INTEGER NOT NULL,
                total_pnl REAL NOT NULL,
                win_rate REAL NOT NULL,
                equity_start REAL NOT NULL,
                equity_end REAL NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_stats(date);
        `);

        // Bot state snapshots
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS state_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                equity REAL NOT NULL,
                daily_pnl REAL NOT NULL,
                daily_trades INTEGER NOT NULL,
                position_side TEXT,
                position_size REAL,
                consecutive_losses INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON state_snapshots(timestamp);
        `);

        this.logger.info('Database tables initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVE TRADE
    // ─────────────────────────────────────────────────────────────────────────
    saveTrade(
        trade: TradeResult,
        symbol: string,
        leverage: number,
        size: number,
        fees?: number,
        slippage?: number
    ): number {
        const stmt = this.db.prepare(`
            INSERT INTO trades (
                timestamp, symbol, side, entry_price, exit_price,
                size, pnl, pnl_percent, duration, exit_reason,
                leverage, fees, slippage
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            Date.now(),
            symbol,
            trade.side,
            trade.entryPrice,
            trade.exitPrice,
            size,
            trade.pnl,
            trade.pnlPercent,
            trade.duration,
            trade.exitReason,
            leverage,
            fees,
            slippage
        );

        this.logger.info(`Trade saved to database: ID ${result.lastInsertRowid}`);
        return result.lastInsertRowid as number;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET TRADES
    // ─────────────────────────────────────────────────────────────────────────
    getTrades(limit: number = 100, offset: number = 0): TradeRecord[] {
        const stmt = this.db.prepare(`
            SELECT
                id, timestamp, symbol, side, entry_price as entryPrice,
                exit_price as exitPrice, size, pnl, pnl_percent as pnlPercent,
                duration, exit_reason as exitReason, leverage, fees, slippage
            FROM trades
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        `);

        return stmt.all(limit, offset) as TradeRecord[];
    }

    getTradesBySymbol(symbol: string, limit: number = 100): TradeRecord[] {
        const stmt = this.db.prepare(`
            SELECT
                id, timestamp, symbol, side, entry_price as entryPrice,
                exit_price as exitPrice, size, pnl, pnl_percent as pnlPercent,
                duration, exit_reason as exitReason, leverage, fees, slippage
            FROM trades
            WHERE symbol = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        return stmt.all(symbol, limit) as TradeRecord[];
    }

    getTradesByDateRange(startDate: number, endDate: number): TradeRecord[] {
        const stmt = this.db.prepare(`
            SELECT
                id, timestamp, symbol, side, entry_price as entryPrice,
                exit_price as exitPrice, size, pnl, pnl_percent as pnlPercent,
                duration, exit_reason as exitReason, leverage, fees, slippage
            FROM trades
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp DESC
        `);

        return stmt.all(startDate, endDate) as TradeRecord[];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVE STATE SNAPSHOT
    // ─────────────────────────────────────────────────────────────────────────
    saveStateSnapshot(state: BotState): void {
        const stmt = this.db.prepare(`
            INSERT INTO state_snapshots (
                timestamp, equity, daily_pnl, daily_trades,
                position_side, position_size, consecutive_losses
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            Date.now(),
            state.equity,
            state.dailyPnl,
            state.dailyTrades,
            state.position?.side || null,
            state.position?.size || null,
            state.consecutiveLosses || 0
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVE DAILY STATS
    // ─────────────────────────────────────────────────────────────────────────
    saveDailyStats(
        date: string,
        totalTrades: number,
        winningTrades: number,
        losingTrades: number,
        totalPnl: number,
        winRate: number,
        equityStart: number,
        equityEnd: number
    ): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO daily_stats (
                date, total_trades, winning_trades, losing_trades,
                total_pnl, win_rate, equity_start, equity_end
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            date,
            totalTrades,
            winningTrades,
            losingTrades,
            totalPnl,
            winRate,
            equityStart,
            equityEnd
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE PERFORMANCE METRICS
    // ─────────────────────────────────────────────────────────────────────────
    calculatePerformanceMetrics(days?: number): PerformanceMetrics {
        let query = 'SELECT * FROM trades';

        if (days) {
            const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
            query += ` WHERE timestamp >= ${cutoffTime}`;
        }

        const trades = this.db.prepare(query).all() as any[];

        if (trades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnl: 0,
                averageWin: 0,
                averageLoss: 0,
                largestWin: 0,
                largestLoss: 0,
                profitFactor: 0,
                averageDuration: 0,
                sharpeRatio: 0,
                maxDrawdown: 0,
                maxDrawdownPercent: 0
            };
        }

        const winningTrades = trades.filter(t => t.pnl > 0);
        const losingTrades = trades.filter(t => t.pnl <= 0);

        const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
        const winRate = (winningTrades.length / trades.length) * 100;

        const averageWin =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
                : 0;

        const averageLoss =
            losingTrades.length > 0
                ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losingTrades.length
                : 0;

        const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl)) : 0;
        const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnl)) : 0;

        const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        const averageDuration =
            trades.reduce((sum, t) => sum + t.duration, 0) / trades.length;

        // Calculate Sharpe Ratio
        const returns = trades.map(t => t.pnl_percent);
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
        );
        const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

        // Calculate max drawdown
        let equity = 10000; // Assume starting equity
        let peak = equity;
        let maxDrawdown = 0;

        trades.forEach(t => {
            equity += t.pnl;
            if (equity > peak) {
                peak = equity;
            }
            const drawdown = peak - equity;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        });

        const maxDrawdownPercent = (maxDrawdown / peak) * 100;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            totalPnl,
            averageWin,
            averageLoss,
            largestWin,
            largestLoss,
            profitFactor,
            averageDuration,
            sharpeRatio,
            maxDrawdown,
            maxDrawdownPercent
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPORT TO CSV
    // ─────────────────────────────────────────────────────────────────────────
    exportToCSV(outputPath: string): void {
        const trades = this.db.prepare('SELECT * FROM trades ORDER BY timestamp').all() as any[];

        const headers = Object.keys(trades[0] || {}).join(',');
        const rows = trades.map(trade =>
            Object.values(trade)
                .map(v => (typeof v === 'string' ? `"${v}"` : v))
                .join(',')
        );

        const csv = [headers, ...rows].join('\n');

        require('fs').writeFileSync(outputPath, csv);
        this.logger.info(`Trades exported to ${outputPath}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    close(): void {
        this.db.close();
        this.logger.info('Database connection closed');
    }
}
