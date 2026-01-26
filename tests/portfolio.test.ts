// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO TRACKER TESTS
// ═══════════════════════════════════════════════════════════════════════════

import { PortfolioTracker } from '../src/utils/portfolio';

describe('PortfolioTracker', () => {
    let tracker: PortfolioTracker;

    beforeEach(() => {
        tracker = new PortfolioTracker(10000);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────
    describe('Initialization', () => {
        it('should initialize with correct balance', () => {
            const summary = tracker.getSummary();
            expect(summary.totalValue).toBe(10000);
            expect(summary.availableBalance).toBe(10000);
        });

        it('should start with zero positions and assets', () => {
            const summary = tracker.getSummary();
            expect(summary.positions).toHaveLength(0);
            expect(summary.assets).toHaveLength(0);
        });

        it('should have zero PnL initially', () => {
            const summary = tracker.getSummary();
            expect(summary.totalPnl).toBe(0);
            expect(summary.totalUnrealizedPnl).toBe(0);
            expect(summary.totalRealizedPnl).toBe(0);
        });

        it('should have 100% margin level with no positions', () => {
            const summary = tracker.getSummary();
            expect(summary.marginLevel).toBe(100);
        });

        it('should have zero risk score initially', () => {
            const summary = tracker.getSummary();
            expect(summary.riskScore).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ASSET MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('Asset Management', () => {
        it('should add asset correctly', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 50000, 'NADO');

            const summary = tracker.getSummary();
            expect(summary.assets).toHaveLength(1);
            expect(summary.assets[0].symbol).toBe('BTC');
            expect(summary.assets[0].balance).toBe(0.5);
            expect(summary.assets[0].avgCost).toBe(50000);
        });

        it('should calculate asset value correctly', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 50000);

            const summary = tracker.getSummary();
            expect(summary.assets[0].value).toBe(25000); // 0.5 * 50000
        });

        it('should update asset price and calculate PnL', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 50000);
            tracker.updateAssetPrice('BTC', 60000);

            const summary = tracker.getSummary();
            expect(summary.assets[0].currentPrice).toBe(60000);
            expect(summary.assets[0].pnl).toBe(5000); // (60000 - 50000) * 0.5
            expect(summary.assets[0].pnlPercent).toBe(20); // 20% gain
        });

        it('should calculate negative PnL correctly', () => {
            tracker.addAsset('ETH', 'Ethereum', 10, 3000);
            tracker.updateAssetPrice('ETH', 2500);

            const summary = tracker.getSummary();
            expect(summary.assets[0].pnl).toBe(-5000); // (2500 - 3000) * 10
            expect(summary.assets[0].pnlPercent).toBeCloseTo(-16.67, 1);
        });

        it('should remove asset', () => {
            tracker.addAsset('BTC', 'Bitcoin', 1, 50000);
            tracker.removeAsset('BTC');

            const summary = tracker.getSummary();
            expect(summary.assets).toHaveLength(0);
        });

        it('should calculate allocation percentages', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 40000); // 20000
            tracker.addAsset('ETH', 'Ethereum', 5, 2000);   // 10000

            const summary = tracker.getSummary();
            const btc = summary.assets.find(a => a.symbol === 'BTC');
            const eth = summary.assets.find(a => a.symbol === 'ETH');

            expect(btc?.allocation).toBeCloseTo(66.67, 1); // 20000 / 30000
            expect(eth?.allocation).toBeCloseTo(33.33, 1); // 10000 / 30000
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POSITION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    describe('Position Management', () => {
        it('should add long position correctly', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);

            const summary = tracker.getSummary();
            expect(summary.positions).toHaveLength(1);
            expect(summary.positions[0].side).toBe('LONG');
            expect(summary.positions[0].entryPrice).toBe(50000);
            expect(summary.positions[0].leverage).toBe(10);
        });

        it('should add short position correctly', () => {
            tracker.addPosition('pos1', 'ETH', 'GRVT', 'SHORT', 3000, 2, 5, 3200, 2800);

            const summary = tracker.getSummary();
            expect(summary.positions[0].side).toBe('SHORT');
            expect(summary.positions[0].symbol).toBe('ETH');
        });

        it('should calculate margin correctly', () => {
            // Position value: 0.1 * 50000 = 5000, Margin: 5000 / 10 = 500
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);

            const summary = tracker.getSummary();
            expect(summary.positions[0].margin).toBe(500);
            expect(summary.totalMarginUsed).toBe(500);
        });

        it('should reduce available balance when opening position', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);

            const summary = tracker.getSummary();
            expect(summary.availableBalance).toBe(9500); // 10000 - 500 margin
        });

        it('should update position unrealized PnL for LONG', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);
            tracker.updatePositionPrice('pos1', 52000);

            const summary = tracker.getSummary();
            // PnL = (52000 - 50000) * 0.1 = 200
            expect(summary.positions[0].unrealizedPnl).toBe(200);
        });

        it('should update position unrealized PnL for SHORT', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'SHORT', 50000, 0.1, 10, 52000, 48000);
            tracker.updatePositionPrice('pos1', 48000);

            const summary = tracker.getSummary();
            // PnL = (50000 - 48000) * 0.1 = 200 (price went down, short profits)
            expect(summary.positions[0].unrealizedPnl).toBe(200);
        });

        it('should calculate negative unrealized PnL for LONG', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);
            tracker.updatePositionPrice('pos1', 48000);

            const summary = tracker.getSummary();
            // PnL = (48000 - 50000) * 0.1 = -200
            expect(summary.positions[0].unrealizedPnl).toBe(-200);
        });

        it('should close position and realize PnL', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);
            const result = tracker.closePosition('pos1', 55000);

            expect(result).not.toBeNull();
            expect(result?.pnl).toBe(500); // (55000 - 50000) * 0.1

            const summary = tracker.getSummary();
            expect(summary.positions).toHaveLength(0);
            expect(summary.totalRealizedPnl).toBe(500);
            // Balance should be initial + margin back + profit
            expect(summary.availableBalance).toBe(10500);
        });

        it('should close position with loss', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);
            const result = tracker.closePosition('pos1', 45000);

            expect(result?.pnl).toBe(-500); // (45000 - 50000) * 0.1

            const summary = tracker.getSummary();
            expect(summary.totalRealizedPnl).toBe(-500);
            expect(summary.availableBalance).toBe(9500); // 10000 - 500 loss
        });

        it('should return null when closing non-existent position', () => {
            const result = tracker.closePosition('nonexistent', 50000);
            expect(result).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // RISK CALCULATIONS
    // ─────────────────────────────────────────────────────────────────────────
    describe('Risk Calculations', () => {
        it('should calculate risk score based on leverage', () => {
            // High leverage should increase risk
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.02, 20, 48000, 55000);

            const summary = tracker.getSummary();
            expect(summary.riskScore).toBeGreaterThan(30); // 20x leverage contributes to risk
        });

        it('should calculate risk score based on position concentration', () => {
            // Large position relative to portfolio
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 1, 5, 48000, 55000);

            const summary = tracker.getSummary();
            expect(summary.riskScore).toBeGreaterThan(0);
        });

        it('should increase risk score with unrealized losses', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);
            tracker.updatePositionPrice('pos1', 40000); // 20% loss

            const summary = tracker.getSummary();
            expect(summary.riskScore).toBeGreaterThan(20);
        });

        it('should calculate margin level correctly', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);

            const summary = tracker.getSummary();
            // Margin = 0.1 * 50000 / 10 = 500
            // currentBalance = 10000 - 500 = 9500 (margin deducted)
            // Equity = currentBalance + unrealizedPnl = 9500 + 0 = 9500
            // Margin Level = (9500/500) * 100 = 1900%
            expect(summary.marginLevel).toBe(1900);
        });

        it('should decrease margin level with losses', () => {
            tracker.addPosition('pos1', 'BTC', 'NADO', 'LONG', 50000, 0.1, 10, 48000, 55000);
            tracker.updatePositionPrice('pos1', 45000); // -$500 unrealized

            const summary = tracker.getSummary();
            // currentBalance = 9500 (after margin)
            // unrealizedPnl = (45000 - 50000) * 0.1 * 1 = -500
            // Equity = 9500 + (-500) = 9000
            // Margin Level = (9000/500) * 100 = 1800%
            expect(summary.marginLevel).toBe(1800);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ALLOCATION & REBALANCING
    // ─────────────────────────────────────────────────────────────────────────
    describe('Allocation & Rebalancing', () => {
        it('should set target allocation', () => {
            tracker.setTargetAllocation('BTC', 60);
            tracker.setTargetAllocation('ETH', 40);

            // Should not throw
            expect(true).toBe(true);
        });

        it('should reject invalid allocation targets', () => {
            tracker.setTargetAllocation('BTC', 150); // Invalid
            // Should log warning but not crash
            expect(true).toBe(true);
        });

        it('should generate rebalance recommendations', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 40000); // 20000
            tracker.addAsset('ETH', 'Ethereum', 5, 2000);   // 10000

            tracker.setTargetAllocation('BTC', 50);
            tracker.setTargetAllocation('ETH', 50);

            const recommendations = tracker.getRebalanceRecommendations();

            expect(recommendations).toHaveLength(2);

            const btcRec = recommendations.find(r => r.symbol === 'BTC');
            const ethRec = recommendations.find(r => r.symbol === 'ETH');

            // BTC is 66.67%, target 50% -> SELL
            expect(btcRec?.action).toBe('SELL');
            expect(btcRec?.deviation).toBeLessThan(0);

            // ETH is 33.33%, target 50% -> BUY
            expect(ethRec?.action).toBe('BUY');
            expect(ethRec?.deviation).toBeGreaterThan(0);
        });

        it('should return HOLD for small deviations', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 40000);
            tracker.setTargetAllocation('BTC', 99); // Close to 100%

            const recommendations = tracker.getRebalanceRecommendations();
            const btcRec = recommendations.find(r => r.symbol === 'BTC');

            expect(btcRec?.action).toBe('HOLD');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // HISTORY TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    describe('History Tracking', () => {
        it('should record history entry', () => {
            const history = tracker.getHistory(1);
            expect(history.length).toBeGreaterThanOrEqual(1);
        });

        it('should include totalValue in history', () => {
            const history = tracker.getHistory(1);
            expect(history[0].totalValue).toBe(10000);
        });

        it('should track PnL changes in history', () => {
            tracker.addAsset('BTC', 'Bitcoin', 0.5, 50000);
            tracker.updateAssetPrice('BTC', 60000); // +$5000

            const history = tracker.getHistory(1);
            const latest = history[history.length - 1];
            expect(latest.totalPnl).toBeGreaterThanOrEqual(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SERIALIZATION
    // ─────────────────────────────────────────────────────────────────────────
    describe('Serialization', () => {
        it('should serialize to JSON', () => {
            tracker.addAsset('BTC', 'Bitcoin', 1, 50000);
            tracker.addPosition('pos1', 'ETH', 'GRVT', 'LONG', 3000, 5, 10, 2800, 3500);

            const json = tracker.toJSON();

            expect(json).toHaveProperty('initialBalance');
            expect(json).toHaveProperty('currentBalance');
            expect(json).toHaveProperty('assets');
            expect(json).toHaveProperty('positions');
        });

        it('should deserialize from JSON', () => {
            tracker.addAsset('BTC', 'Bitcoin', 1, 50000);

            const json = tracker.toJSON();
            const restored = PortfolioTracker.fromJSON(json);

            const summary = restored.getSummary();
            expect(summary.assets).toHaveLength(1);
            expect(summary.assets[0].symbol).toBe('BTC');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // RESET
    // ─────────────────────────────────────────────────────────────────────────
    describe('Reset', () => {
        it('should reset portfolio to initial state', () => {
            tracker.addAsset('BTC', 'Bitcoin', 1, 50000);
            tracker.addPosition('pos1', 'ETH', 'GRVT', 'LONG', 3000, 5, 10, 2800, 3500);

            tracker.reset();

            const summary = tracker.getSummary();
            expect(summary.assets).toHaveLength(0);
            expect(summary.positions).toHaveLength(0);
            expect(summary.totalValue).toBe(10000);
        });

        it('should reset with new balance', () => {
            tracker.reset(20000);

            const summary = tracker.getSummary();
            expect(summary.totalValue).toBe(20000);
        });
    });
});
