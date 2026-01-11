// ═══════════════════════════════════════════════════════════════════════════
// RISK MANAGEMENT TESTS
// Unit tests for position sizing and risk controls
// ═══════════════════════════════════════════════════════════════════════════

import { RiskManager } from '../src/risk';
import { RiskConfig, BotState, Position } from '../src/types';
import { Logger } from '../src/utils/logger';

describe('RiskManager', () => {
    const mockConfig: RiskConfig = {
        maxPositionSize: 20,
        maxDailyLoss: 3,
        maxDailyTrades: 3,
        riskRewardRatio: 1.5,
        stopLossAtrMultiplier: 1.5,
        cooldownMinutes: 30
    };

    const mockLogger = new Logger('Test', false);
    let riskManager: RiskManager;

    beforeEach(() => {
        riskManager = new RiskManager(mockConfig, mockLogger);
    });

    describe('canOpenPosition', () => {
        it('should allow trade when all conditions are met', () => {
            const state: BotState = {
                position: null,
                dailyPnl: 0,
                dailyTrades: 0,
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: []
            };

            const result = riskManager.canOpenPosition(state);

            expect(result.allowed).toBe(true);
            expect(result.reason).toBe('Trade allowed');
        });

        it('should block trade when position already exists', () => {
            const state: BotState = {
                position: {
                    side: 'LONG',
                    entryPrice: 100,
                    size: 1,
                    stopLoss: 95,
                    takeProfit: 110,
                    entryTime: Date.now(),
                    unrealizedPnl: 0
                },
                dailyPnl: 0,
                dailyTrades: 0,
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: []
            };

            const result = riskManager.canOpenPosition(state);

            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('Position already open');
        });

        it('should block trade when daily loss limit hit', () => {
            const state: BotState = {
                position: null,
                dailyPnl: -350, // -3.5% of 10000
                dailyTrades: 1,
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: []
            };

            const result = riskManager.canOpenPosition(state);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Daily loss limit hit');
        });

        it('should block trade when daily trade limit hit', () => {
            const state: BotState = {
                position: null,
                dailyPnl: 0,
                dailyTrades: 3, // Max is 3
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: []
            };

            const result = riskManager.canOpenPosition(state);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Daily trade limit hit');
        });

        it('should block trade during cooldown period', () => {
            const state: BotState = {
                position: null,
                dailyPnl: -50,
                dailyTrades: 1,
                lastTradeTime: Date.now() - 10000, // 10 seconds ago
                lastLossTime: Date.now() - 10000, // 10 seconds ago (cooldown is 30 min)
                isActive: true,
                equity: 10000,
                trades: []
            };

            const result = riskManager.canOpenPosition(state);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Cooldown active');
        });

        it('should allow trade after cooldown period', () => {
            const state: BotState = {
                position: null,
                dailyPnl: -50,
                dailyTrades: 1,
                lastTradeTime: Date.now() - 40 * 60 * 1000, // 40 min ago
                lastLossTime: Date.now() - 40 * 60 * 1000, // 40 min ago
                isActive: true,
                equity: 10000,
                trades: []
            };

            const result = riskManager.canOpenPosition(state);

            expect(result.allowed).toBe(true);
        });
    });

    describe('calculatePositionSize', () => {
        it('should calculate position size based on risk', () => {
            const equity = 10000;
            const entryPrice = 100;
            const stopLoss = 95; // 5% stop
            const leverage = 3;

            const size = riskManager.calculatePositionSize(equity, entryPrice, stopLoss, leverage);

            expect(size).toBeGreaterThan(0);
            expect(size * entryPrice).toBeLessThanOrEqual(equity * 0.2 * leverage); // Max 20% position
        });

        it('should respect maximum position size', () => {
            const equity = 10000;
            const entryPrice = 100;
            const stopLoss = 99.5; // Very tight stop
            const leverage = 3;

            const size = riskManager.calculatePositionSize(equity, entryPrice, stopLoss, leverage);
            const positionValue = size * entryPrice;

            expect(positionValue).toBeLessThanOrEqual(equity * 0.2 * leverage);
        });
    });

    describe('checkSLTP', () => {
        const position: Position = {
            side: 'LONG',
            entryPrice: 100,
            size: 1,
            stopLoss: 95,
            takeProfit: 110,
            entryTime: Date.now(),
            unrealizedPnl: 0
        };

        it('should detect stop loss hit for LONG', () => {
            const result = riskManager.checkSLTP(position, 94);

            expect(result.hit).toBe(true);
            expect(result.type).toBe('SL');
        });

        it('should detect take profit hit for LONG', () => {
            const result = riskManager.checkSLTP(position, 111);

            expect(result.hit).toBe(true);
            expect(result.type).toBe('TP');
        });

        it('should not trigger when price is between SL and TP', () => {
            const result = riskManager.checkSLTP(position, 100);

            expect(result.hit).toBe(false);
            expect(result.type).toBeNull();
        });

        it('should detect stop loss hit for SHORT', () => {
            const shortPosition: Position = {
                side: 'SHORT',
                entryPrice: 100,
                size: 1,
                stopLoss: 105,
                takeProfit: 90,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const result = riskManager.checkSLTP(shortPosition, 106);

            expect(result.hit).toBe(true);
            expect(result.type).toBe('SL');
        });
    });

    describe('calculatePnl', () => {
        it('should calculate LONG PnL correctly', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const result = riskManager.calculatePnl(position, 110, 3);

            expect(result.pnl).toBeGreaterThan(0);
            expect(result.pnlPercent).toBeCloseTo(30, 0); // 10% price change * 3x leverage
        });

        it('should calculate SHORT PnL correctly', () => {
            const position: Position = {
                side: 'SHORT',
                entryPrice: 100,
                size: 1,
                stopLoss: 105,
                takeProfit: 90,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const result = riskManager.calculatePnl(position, 90, 3);

            expect(result.pnl).toBeGreaterThan(0);
            expect(result.pnlPercent).toBeCloseTo(30, 0); // 10% price change * 3x leverage
        });

        it('should calculate negative PnL for losing trade', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const result = riskManager.calculatePnl(position, 95, 3);

            expect(result.pnl).toBeLessThan(0);
            expect(result.pnlPercent).toBeCloseTo(-15, 0); // -5% price change * 3x leverage
        });
    });
});
