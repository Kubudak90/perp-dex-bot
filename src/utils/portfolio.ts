// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO TRACKER
// Multi-asset portfolio management and tracking
// ═══════════════════════════════════════════════════════════════════════════

import { Logger } from './logger';
import { ExchangeType, Position, TradeResult } from '../types';

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────
export interface Asset {
    symbol: string;
    name: string;
    balance: number;
    avgCost: number;
    currentPrice: number;
    value: number;
    pnl: number;
    pnlPercent: number;
    allocation: number; // Percentage of total portfolio
    exchange?: ExchangeType;
}

export interface PortfolioPosition extends Position {
    symbol: string;
    exchange: ExchangeType;
    leverage: number;
    margin: number;
    liquidationPrice: number;
    markPrice: number;
    percentOfPortfolio: number;
}

export interface PortfolioSummary {
    totalValue: number;
    totalCost: number;
    totalPnl: number;
    totalPnlPercent: number;
    totalUnrealizedPnl: number;
    totalRealizedPnl: number;
    totalMarginUsed: number;
    availableBalance: number;
    marginLevel: number; // Margin health percentage
    riskScore: number; // 0-100, higher = more risk
    assets: Asset[];
    positions: PortfolioPosition[];
    lastUpdated: number;
}

export interface PortfolioHistoryEntry {
    timestamp: number;
    totalValue: number;
    totalPnl: number;
    positionCount: number;
}

export interface AllocationTarget {
    symbol: string;
    targetPercent: number;
    currentPercent: number;
    deviation: number;
    action: 'BUY' | 'SELL' | 'HOLD';
    amount: number;
}

// ─────────────────────────────────────────────────────────────────────────
// PORTFOLIO TRACKER SERVICE
// ─────────────────────────────────────────────────────────────────────────
export class PortfolioTracker {
    private logger: Logger;
    private assets: Map<string, Asset> = new Map();
    private positions: Map<string, PortfolioPosition> = new Map();
    private history: PortfolioHistoryEntry[] = [];
    private realizedPnl: number = 0;
    private initialBalance: number;
    private currentBalance: number;
    private targetAllocations: Map<string, number> = new Map();

    constructor(initialBalance: number = 10000) {
        this.logger = new Logger('Portfolio');
        this.initialBalance = initialBalance;
        this.currentBalance = initialBalance;

        // Start history tracking
        this.recordHistory();
        setInterval(() => this.recordHistory(), 60000); // Every minute
    }

    // ─────────────────────────────────────────────────────────────────────
    // ASSET MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────
    addAsset(symbol: string, name: string, balance: number, avgCost: number, exchange?: ExchangeType): void {
        const asset: Asset = {
            symbol,
            name,
            balance,
            avgCost,
            currentPrice: avgCost,
            value: balance * avgCost,
            pnl: 0,
            pnlPercent: 0,
            allocation: 0,
            exchange
        };
        this.assets.set(symbol, asset);
        this.updateAllocations();
        this.logger.info(`Asset added: ${symbol} - ${balance} @ $${avgCost}`);
    }

    updateAssetPrice(symbol: string, price: number): void {
        const asset = this.assets.get(symbol);
        if (!asset) return;

        asset.currentPrice = price;
        asset.value = asset.balance * price;
        asset.pnl = (price - asset.avgCost) * asset.balance;
        asset.pnlPercent = asset.avgCost > 0 ? ((price - asset.avgCost) / asset.avgCost) * 100 : 0;

        this.updateAllocations();
    }

    removeAsset(symbol: string): void {
        this.assets.delete(symbol);
        this.updateAllocations();
        this.logger.info(`Asset removed: ${symbol}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POSITION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────
    addPosition(
        id: string,
        symbol: string,
        exchange: ExchangeType,
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        size: number,
        leverage: number,
        stopLoss: number,
        takeProfit: number
    ): void {
        const margin = (size * entryPrice) / leverage;
        const liquidationPrice = this.calculateLiquidationPrice(side, entryPrice, leverage);

        const position: PortfolioPosition = {
            symbol,
            exchange,
            side,
            entryPrice,
            size,
            leverage,
            margin,
            liquidationPrice,
            markPrice: entryPrice,
            stopLoss,
            takeProfit,
            entryTime: Date.now(),
            unrealizedPnl: 0,
            percentOfPortfolio: 0
        };

        this.positions.set(id, position);
        this.currentBalance -= margin;
        this.updatePositionAllocations();
        this.logger.info(`Position opened: ${side} ${symbol} @ $${entryPrice} (${leverage}x)`);
    }

    updatePositionPrice(id: string, markPrice: number): void {
        const position = this.positions.get(id);
        if (!position) return;

        position.markPrice = markPrice;
        const priceDiff = markPrice - position.entryPrice;
        const direction = position.side === 'LONG' ? 1 : -1;
        position.unrealizedPnl = priceDiff * position.size * direction;

        this.updatePositionAllocations();
    }

    closePosition(id: string, exitPrice: number): TradeResult | null {
        const position = this.positions.get(id);
        if (!position) return null;

        const priceDiff = exitPrice - position.entryPrice;
        const direction = position.side === 'LONG' ? 1 : -1;
        const pnl = priceDiff * position.size * direction;
        const pnlPercent = (priceDiff / position.entryPrice) * 100 * direction * position.leverage;

        this.realizedPnl += pnl;
        this.currentBalance += position.margin + pnl;

        const result: TradeResult = {
            side: position.side,
            entryPrice: position.entryPrice,
            exitPrice,
            size: position.size,
            pnl,
            pnlPercent,
            entryTime: position.entryTime,
            exitTime: Date.now(),
            duration: Date.now() - position.entryTime,
            exitReason: 'SIGNAL'
        };

        this.positions.delete(id);
        this.updatePositionAllocations();
        this.logger.info(`Position closed: ${position.side} ${position.symbol} PnL: $${pnl.toFixed(2)}`);

        return result;
    }

    private calculateLiquidationPrice(side: 'LONG' | 'SHORT', entryPrice: number, leverage: number): number {
        // Simplified liquidation calculation (actual varies by exchange)
        const maintenanceMargin = 0.5; // 0.5% maintenance margin
        const liquidationThreshold = (1 / leverage) - (maintenanceMargin / 100);

        if (side === 'LONG') {
            return entryPrice * (1 - liquidationThreshold);
        } else {
            return entryPrice * (1 + liquidationThreshold);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ALLOCATION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────
    setTargetAllocation(symbol: string, targetPercent: number): void {
        if (targetPercent < 0 || targetPercent > 100) {
            this.logger.warn(`Invalid allocation target: ${targetPercent}%`);
            return;
        }
        this.targetAllocations.set(symbol, targetPercent);
        this.logger.info(`Target allocation set: ${symbol} = ${targetPercent}%`);
    }

    getRebalanceRecommendations(): AllocationTarget[] {
        const summary = this.getSummary();
        const recommendations: AllocationTarget[] = [];

        for (const [symbol, targetPercent] of this.targetAllocations) {
            const asset = this.assets.get(symbol);
            const currentPercent = asset?.allocation || 0;
            const deviation = targetPercent - currentPercent;

            let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
            let amount = 0;

            if (Math.abs(deviation) > 2) { // 2% threshold
                if (deviation > 0) {
                    action = 'BUY';
                    amount = (deviation / 100) * summary.totalValue;
                } else {
                    action = 'SELL';
                    amount = Math.abs(deviation / 100) * summary.totalValue;
                }
            }

            recommendations.push({
                symbol,
                targetPercent,
                currentPercent,
                deviation,
                action,
                amount
            });
        }

        return recommendations.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
    }

    private updateAllocations(): void {
        const totalValue = this.getTotalAssetValue();
        for (const asset of this.assets.values()) {
            asset.allocation = totalValue > 0 ? (asset.value / totalValue) * 100 : 0;
        }
    }

    private updatePositionAllocations(): void {
        const totalValue = this.getTotalValue();
        for (const position of this.positions.values()) {
            const positionValue = position.margin + position.unrealizedPnl;
            position.percentOfPortfolio = totalValue > 0 ? (positionValue / totalValue) * 100 : 0;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // VALUE CALCULATIONS
    // ─────────────────────────────────────────────────────────────────────
    private getTotalAssetValue(): number {
        let total = 0;
        for (const asset of this.assets.values()) {
            total += asset.value;
        }
        return total;
    }

    private getTotalPositionValue(): number {
        let total = 0;
        for (const position of this.positions.values()) {
            total += position.margin + position.unrealizedPnl;
        }
        return total;
    }

    getTotalValue(): number {
        return this.currentBalance + this.getTotalPositionValue() + this.getTotalAssetValue();
    }

    getTotalUnrealizedPnl(): number {
        let total = 0;
        for (const position of this.positions.values()) {
            total += position.unrealizedPnl;
        }
        for (const asset of this.assets.values()) {
            total += asset.pnl;
        }
        return total;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RISK CALCULATIONS
    // ─────────────────────────────────────────────────────────────────────
    calculateRiskScore(): number {
        let riskScore = 0;
        const totalValue = this.getTotalValue();

        // Leverage risk (0-30 points)
        let avgLeverage = 0;
        if (this.positions.size > 0) {
            for (const position of this.positions.values()) {
                avgLeverage += position.leverage;
            }
            avgLeverage /= this.positions.size;
        }
        riskScore += Math.min(30, avgLeverage * 3);

        // Position concentration risk (0-25 points)
        let maxPositionPercent = 0;
        for (const position of this.positions.values()) {
            maxPositionPercent = Math.max(maxPositionPercent, position.percentOfPortfolio);
        }
        riskScore += Math.min(25, maxPositionPercent * 0.5);

        // Margin utilization risk (0-25 points)
        const marginUsed = Array.from(this.positions.values()).reduce((sum, p) => sum + p.margin, 0);
        const marginUtilization = totalValue > 0 ? (marginUsed / totalValue) * 100 : 0;
        riskScore += Math.min(25, marginUtilization * 0.5);

        // Unrealized loss risk (0-20 points)
        const unrealizedPnl = this.getTotalUnrealizedPnl();
        if (unrealizedPnl < 0) {
            const lossPercent = Math.abs(unrealizedPnl / totalValue) * 100;
            riskScore += Math.min(20, lossPercent * 2);
        }

        return Math.round(Math.min(100, riskScore));
    }

    calculateMarginLevel(): number {
        const marginUsed = Array.from(this.positions.values()).reduce((sum, p) => sum + p.margin, 0);
        if (marginUsed === 0) return 100;

        const equity = this.currentBalance + this.getTotalUnrealizedPnl();
        return (equity / marginUsed) * 100;
    }

    // ─────────────────────────────────────────────────────────────────────
    // HISTORY TRACKING
    // ─────────────────────────────────────────────────────────────────────
    private recordHistory(): void {
        this.history.push({
            timestamp: Date.now(),
            totalValue: this.getTotalValue(),
            totalPnl: this.getTotalValue() - this.initialBalance,
            positionCount: this.positions.size
        });

        // Keep last 7 days of minute-by-minute data
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        this.history = this.history.filter(h => h.timestamp > sevenDaysAgo);
    }

    getHistory(hours: number = 24): PortfolioHistoryEntry[] {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        return this.history.filter(h => h.timestamp > cutoff);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    getSummary(): PortfolioSummary {
        const totalValue = this.getTotalValue();
        const totalUnrealizedPnl = this.getTotalUnrealizedPnl();
        const marginUsed = Array.from(this.positions.values()).reduce((sum, p) => sum + p.margin, 0);

        return {
            totalValue,
            totalCost: this.initialBalance,
            totalPnl: totalValue - this.initialBalance,
            totalPnlPercent: ((totalValue - this.initialBalance) / this.initialBalance) * 100,
            totalUnrealizedPnl,
            totalRealizedPnl: this.realizedPnl,
            totalMarginUsed: marginUsed,
            availableBalance: this.currentBalance,
            marginLevel: this.calculateMarginLevel(),
            riskScore: this.calculateRiskScore(),
            assets: Array.from(this.assets.values()),
            positions: Array.from(this.positions.values()),
            lastUpdated: Date.now()
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // SERIALIZATION
    // ─────────────────────────────────────────────────────────────────────
    toJSON(): object {
        return {
            initialBalance: this.initialBalance,
            currentBalance: this.currentBalance,
            realizedPnl: this.realizedPnl,
            assets: Array.from(this.assets.entries()),
            positions: Array.from(this.positions.entries()),
            targetAllocations: Array.from(this.targetAllocations.entries()),
            history: this.history.slice(-1000) // Last 1000 entries
        };
    }

    static fromJSON(data: any): PortfolioTracker {
        const tracker = new PortfolioTracker(data.initialBalance);
        tracker.currentBalance = data.currentBalance;
        tracker.realizedPnl = data.realizedPnl;

        for (const [key, value] of data.assets || []) {
            tracker.assets.set(key, value as Asset);
        }
        for (const [key, value] of data.positions || []) {
            tracker.positions.set(key, value as PortfolioPosition);
        }
        for (const [key, value] of data.targetAllocations || []) {
            tracker.targetAllocations.set(key, value as number);
        }
        tracker.history = data.history || [];

        return tracker;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RESET
    // ─────────────────────────────────────────────────────────────────────
    reset(newBalance?: number): void {
        this.assets.clear();
        this.positions.clear();
        this.history = [];
        this.realizedPnl = 0;
        this.initialBalance = newBalance || this.initialBalance;
        this.currentBalance = this.initialBalance;
        this.logger.info(`Portfolio reset with balance: $${this.initialBalance}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT SINGLETON
// ─────────────────────────────────────────────────────────────────────────
export const portfolioTracker = new PortfolioTracker();
