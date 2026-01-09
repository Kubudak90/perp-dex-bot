// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED RISK MANAGEMENT TESTS
// Tests for trailing stops, consecutive losses, and portfolio heat
// ═══════════════════════════════════════════════════════════════════════════

import { RiskManager } from '../src/risk';
import { RiskConfig, BotState, Position } from '../src/types';
import { Logger } from '../src/utils/logger';

describe('Advanced Risk Management', () => {
    const mockConfig: RiskConfig = {
        maxPositionSize: 20,
        maxDailyLoss: 3,
        maxDailyTrades: 3,
        riskRewardRatio: 1.5,
        stopLossAtrMultiplier: 1.5,
        cooldownMinutes: 30,
        useTrailingStop: true,
        trailingStopDistance: 2,
        maxConsecutiveLosses: 3,
        maxPortfolioHeat: 10,
        maxHoldTimeHours: 24
    };

    const mockLogger = new Logger('Test', false);
    let riskManager: RiskManager;

    beforeEach(() => {
        riskManager = new RiskManager(mockConfig, mockLogger);
    });

    describe('Trailing Stop Loss', () => {
        it('should update trailing stop for LONG position when price increases', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const currentPrice = 105;
            const peakPrice = 100;

            const result = riskManager.updateTrailingStop(position, currentPrice, peakPrice);

            expect(result.newPeakPrice).toBe(105);
            // 105 * (1 - 2%) = 102.9
            expect(result.newStopLoss).toBeGreaterThan(position.stopLoss);
            expect(result.newStopLoss).toBeCloseTo(102.9, 1);
        });

        it('should NOT lower trailing stop for LONG position', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 102,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const currentPrice = 98;
            const peakPrice = 105;

            const result = riskManager.updateTrailingStop(position, currentPrice, peakPrice);

            expect(result.newStopLoss).toBe(position.stopLoss); // Should not change
            expect(result.newPeakPrice).toBe(peakPrice); // Peak remains
        });

        it('should update trailing stop for SHORT position when price decreases', () => {
            const position: Position = {
                side: 'SHORT',
                entryPrice: 100,
                size: 1,
                stopLoss: 105,
                takeProfit: 90,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const currentPrice = 95;
            const peakPrice = 100;

            const result = riskManager.updateTrailingStop(position, currentPrice, peakPrice);

            expect(result.newPeakPrice).toBe(95);
            // 95 * (1 + 2%) = 96.9
            expect(result.newStopLoss).toBeLessThan(position.stopLoss);
            expect(result.newStopLoss).toBeCloseTo(96.9, 1);
        });

        it('should not update if trailing stop disabled', () => {
            const configNoTrailing: RiskConfig = { ...mockConfig, useTrailingStop: false };
            const manager = new RiskManager(configNoTrailing, mockLogger);

            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const result = manager.updateTrailingStop(position, 105, 100);

            expect(result.newStopLoss).toBe(position.stopLoss);
            expect(result.newPeakPrice).toBe(100);
        });
    });

    describe('Consecutive Losses', () => {
        it('should track consecutive losses correctly', () => {
            const state: BotState = {
                position: null,
                dailyPnl: -100,
                dailyTrades: 2,
                lastTradeTime: Date.now(),
                lastLossTime: Date.now(),
                isActive: true,
                equity: 10000,
                trades: [],
                consecutiveLosses: 2
            };

            const result = riskManager.checkConsecutiveLosses(state);

            expect(result.shouldPause).toBe(false);
            expect(result.consecutiveLosses).toBe(2);
        });

        it('should pause trading after max consecutive losses', () => {
            const state: BotState = {
                position: null,
                dailyPnl: -150,
                dailyTrades: 3,
                lastTradeTime: Date.now(),
                lastLossTime: Date.now(),
                isActive: true,
                equity: 10000,
                trades: [],
                consecutiveLosses: 3
            };

            const result = riskManager.checkConsecutiveLosses(state);

            expect(result.shouldPause).toBe(true);
            expect(result.consecutiveLosses).toBe(3);
        });

        it('should reset consecutive losses on win', () => {
            const state: BotState = {
                position: null,
                dailyPnl: 0,
                dailyTrades: 0,
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: [],
                consecutiveLosses: 2
            };

            const winTrade = {
                side: 'LONG' as const,
                entryPrice: 100,
                exitPrice: 105,
                pnl: 50,
                pnlPercent: 5,
                duration: 60000,
                exitReason: 'TP' as const
            };

            const newState = riskManager.updateStateAfterTradeEnhanced(state, winTrade);

            expect(newState.consecutiveLosses).toBe(0);
        });

        it('should increment consecutive losses on loss', () => {
            const state: BotState = {
                position: null,
                dailyPnl: 0,
                dailyTrades: 0,
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: [],
                consecutiveLosses: 1
            };

            const lossTrade = {
                side: 'LONG' as const,
                entryPrice: 100,
                exitPrice: 95,
                pnl: -50,
                pnlPercent: -5,
                duration: 60000,
                exitReason: 'SL' as const
            };

            const newState = riskManager.updateStateAfterTradeEnhanced(state, lossTrade);

            expect(newState.consecutiveLosses).toBe(2);
        });
    });

    describe('Max Hold Time', () => {
        it('should force close after max hold time', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
                unrealizedPnl: 0
            };

            const result = riskManager.shouldForceClose(position);

            expect(result).toBe(true);
        });

        it('should not force close before max hold time', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now() - 23 * 60 * 60 * 1000, // 23 hours ago
                unrealizedPnl: 0
            };

            const result = riskManager.shouldForceClose(position);

            expect(result).toBe(false);
        });

        it('should return false if max hold time not configured', () => {
            const configNoMaxHold: RiskConfig = { ...mockConfig, maxHoldTimeHours: undefined };
            const manager = new RiskManager(configNoMaxHold, mockLogger);

            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 1,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
                unrealizedPnl: 0
            };

            const result = manager.shouldForceClose(position);

            expect(result).toBe(false);
        });
    });

    describe('Portfolio Heat', () => {
        it('should calculate portfolio heat correctly', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 10,
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const equity = 10000;

            const heat = riskManager.calculatePortfolioHeat(position, equity);

            // Risk = (100 - 95) * 10 = 50
            // Heat = (50 / 10000) * 100 = 0.5%
            expect(heat).toBeCloseTo(0.5, 1);
        });

        it('should calculate heat for SHORT position', () => {
            const position: Position = {
                side: 'SHORT',
                entryPrice: 100,
                size: 10,
                stopLoss: 105,
                takeProfit: 90,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const equity = 10000;

            const heat = riskManager.calculatePortfolioHeat(position, equity);

            // Risk = (105 - 100) * 10 = 50
            // Heat = (50 / 10000) * 100 = 0.5%
            expect(heat).toBeCloseTo(0.5, 1);
        });

        it('should calculate higher heat for larger positions', () => {
            const position: Position = {
                side: 'LONG',
                entryPrice: 100,
                size: 100, // 10x larger
                stopLoss: 95,
                takeProfit: 110,
                entryTime: Date.now(),
                unrealizedPnl: 0
            };

            const equity = 10000;

            const heat = riskManager.calculatePortfolioHeat(position, equity);

            // Risk = (100 - 95) * 100 = 500
            // Heat = (500 / 10000) * 100 = 5%
            expect(heat).toBeCloseTo(5, 1);
        });
    });

    describe('Enhanced State Updates', () => {
        it('should update state with all tracking metrics', () => {
            const state: BotState = {
                position: null,
                dailyPnl: 0,
                dailyTrades: 0,
                lastTradeTime: 0,
                lastLossTime: 0,
                isActive: true,
                equity: 10000,
                trades: [],
                consecutiveLosses: 0,
                peakPrice: undefined,
                portfolioHeat: 0
            };

            const trade = {
                side: 'LONG' as const,
                entryPrice: 100,
                exitPrice: 105,
                pnl: 50,
                pnlPercent: 5,
                duration: 60000,
                exitReason: 'TP' as const
            };

            const newState = riskManager.updateStateAfterTradeEnhanced(state, trade);

            expect(newState.equity).toBe(10050);
            expect(newState.dailyTrades).toBe(1);
            expect(newState.position).toBeNull();
            expect(newState.peakPrice).toBeUndefined();
            expect(newState.portfolioHeat).toBe(0);
            expect(newState.consecutiveLosses).toBe(0);
        });

        it('should preserve equity and update metrics correctly', () => {
            const state: BotState = {
                position: null,
                dailyPnl: 100,
                dailyTrades: 2,
                lastTradeTime: Date.now() - 60000,
                lastLossTime: 0,
                isActive: true,
                equity: 10100,
                trades: [],
                consecutiveLosses: 0
            };

            const trade = {
                side: 'SHORT' as const,
                entryPrice: 100,
                exitPrice: 98,
                pnl: 20,
                pnlPercent: 2,
                duration: 120000,
                exitReason: 'TP' as const
            };

            const newState = riskManager.updateStateAfterTradeEnhanced(state, trade);

            expect(newState.equity).toBe(10120);
            expect(newState.dailyPnl).toBe(120);
            expect(newState.dailyTrades).toBe(3);
        });
    });
});
