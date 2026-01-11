// ═══════════════════════════════════════════════════════════════════════════
// EXTERNAL DATA ANALYSIS (Phase 6C)
// Liquidation Heatmap, Order Book Analysis, Large Order Detection
// ═══════════════════════════════════════════════════════════════════════════

import {
    LiquidationHeatmap,
    OrderBookSnapshot,
    LargeOrder,
    ExternalData
} from '../types';

export class ExternalDataAnalyzer {

    // ─────────────────────────────────────────────────────────────────────────
    // LIQUIDATION HEATMAP ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Check if entry price is too close to major liquidation levels
     * Returns true if safe to enter, false if too close to liquidations
     */
    static isLiquidationSafe(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        liquidations: LiquidationHeatmap,
        avoidDistancePct: number,     // e.g., 0.02 = 2%
        intensityThreshold: number     // e.g., 1000000 = $1M
    ): { safe: boolean; reason?: string; nearestLiq?: number } {
        // For LONG entries, check SHORT liquidations above entry
        // For SHORT entries, check LONG liquidations below entry
        const relevantSide = side === 'LONG' ? 'SHORT' : 'LONG';

        const relevantLevels = liquidations.levels.filter(l => l.side === relevantSide);

        for (const level of relevantLevels) {
            // Skip small liquidation clusters
            if (level.amount < intensityThreshold) continue;

            const distancePct = Math.abs(level.price - entryPrice) / entryPrice;

            if (side === 'LONG') {
                // Check SHORT liquidations above (could cause price spike up then dump)
                if (level.price > entryPrice && distancePct < avoidDistancePct) {
                    return {
                        safe: false,
                        reason: `Major SHORT liquidations at ${level.price.toFixed(2)} (${(distancePct * 100).toFixed(2)}% away, $${(level.amount / 1e6).toFixed(2)}M)`,
                        nearestLiq: level.price
                    };
                }
            } else {
                // Check LONG liquidations below (could cause price dump down then pump)
                if (level.price < entryPrice && distancePct < avoidDistancePct) {
                    return {
                        safe: false,
                        reason: `Major LONG liquidations at ${level.price.toFixed(2)} (${(distancePct * 100).toFixed(2)}% away, $${(level.amount / 1e6).toFixed(2)}M)`,
                        nearestLiq: level.price
                    };
                }
            }
        }

        return { safe: true };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ORDER BOOK ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Analyze order book for liquidity and market conditions
     * Returns assessment of whether conditions are good for trading
     */
    static analyzeOrderBook(
        orderBook: OrderBookSnapshot,
        maxSpreadPct: number,          // e.g., 0.001 = 0.1%
        minDepth: number,               // e.g., 100000 = $100k
        maxImbalance: number            // e.g., 0.7 = 70% one-sided
    ): { tradeable: boolean; reason?: string; quality: 'EXCELLENT' | 'GOOD' | 'POOR' } {
        // Check spread
        if (orderBook.spreadPercent > maxSpreadPct) {
            return {
                tradeable: false,
                reason: `Spread too wide: ${(orderBook.spreadPercent * 100).toFixed(3)}% (max ${(maxSpreadPct * 100).toFixed(3)}%)`,
                quality: 'POOR'
            };
        }

        // Check depth
        const totalDepth = orderBook.bidDepth1pct + orderBook.askDepth1pct;
        if (totalDepth < minDepth) {
            return {
                tradeable: false,
                reason: `Insufficient depth: $${(totalDepth / 1000).toFixed(1)}k (min $${(minDepth / 1000).toFixed(1)}k)`,
                quality: 'POOR'
            };
        }

        // Check imbalance
        if (Math.abs(orderBook.imbalance) > maxImbalance) {
            return {
                tradeable: false,
                reason: `Order book too imbalanced: ${(orderBook.imbalance * 100).toFixed(1)}% (max ${(maxImbalance * 100).toFixed(1)}%)`,
                quality: 'POOR'
            };
        }

        // Determine quality
        let quality: 'EXCELLENT' | 'GOOD' | 'POOR';
        if (orderBook.spreadPercent < maxSpreadPct * 0.5 && totalDepth > minDepth * 2) {
            quality = 'EXCELLENT';
        } else {
            quality = 'GOOD';
        }

        return { tradeable: true, quality };
    }

    /**
     * Detect order book walls (large orders at specific levels)
     * Returns price levels with significant size
     */
    static detectOrderBookWalls(
        orderBook: OrderBookSnapshot,
        minWallSize: number             // e.g., 50000 = $50k
    ): { bidWalls: number[]; askWalls: number[] } {
        const bidWalls: number[] = [];
        const askWalls: number[] = [];

        // Check bids for walls
        for (const bid of orderBook.bids) {
            if (bid.size >= minWallSize) {
                bidWalls.push(bid.price);
            }
        }

        // Check asks for walls
        for (const ask of orderBook.asks) {
            if (ask.size >= minWallSize) {
                askWalls.push(ask.price);
            }
        }

        return { bidWalls, askWalls };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LARGE ORDER TRACKING
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Check if recent large orders indicate contra-trend pressure
     * Returns true if safe to enter, false if recent large contra order
     */
    static isLargeOrderSafe(
        side: 'LONG' | 'SHORT',
        largeOrders: LargeOrder[],
        avoidMinutes: number,          // e.g., 5 = avoid for 5min after
        largeThreshold: number          // e.g., 100000 = $100k
    ): { safe: boolean; reason?: string; lastContraOrder?: LargeOrder } {
        if (!largeOrders || largeOrders.length === 0) {
            return { safe: true };
        }

        const now = Date.now();
        const avoidMs = avoidMinutes * 60 * 1000;

        // For LONG, check for large SELL orders
        // For SHORT, check for large BUY orders
        const contraSide = side === 'LONG' ? 'SELL' : 'BUY';

        for (const order of largeOrders) {
            if (order.side !== contraSide) continue;
            if (order.size < largeThreshold) continue;

            const timeSince = now - order.timestamp;
            if (timeSince < avoidMs) {
                return {
                    safe: false,
                    reason: `Large ${contraSide} order $${(order.size / 1e6).toFixed(2)}M detected ${Math.floor(timeSince / 60000)}min ago`,
                    lastContraOrder: order
                };
            }
        }

        return { safe: true };
    }

    /**
     * Detect if there's whale accumulation/distribution
     * Returns trend based on recent large orders
     */
    static detectWhaleActivity(
        largeOrders: LargeOrder[],
        lookbackMinutes: number = 60
    ): { trend: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL'; buyVolume: number; sellVolume: number } {
        const lookbackMs = lookbackMinutes * 60 * 1000;
        const now = Date.now();

        let buyVolume = 0;
        let sellVolume = 0;

        for (const order of largeOrders) {
            if (now - order.timestamp > lookbackMs) continue;

            if (order.side === 'BUY') {
                buyVolume += order.size;
            } else {
                sellVolume += order.size;
            }
        }

        const totalVolume = buyVolume + sellVolume;
        if (totalVolume === 0) {
            return { trend: 'NEUTRAL', buyVolume: 0, sellVolume: 0 };
        }

        const buyRatio = buyVolume / totalVolume;

        let trend: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
        if (buyRatio > 0.65) {
            trend = 'ACCUMULATING';
        } else if (buyRatio < 0.35) {
            trend = 'DISTRIBUTING';
        } else {
            trend = 'NEUTRAL';
        }

        return { trend, buyVolume, sellVolume };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMBINED ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Comprehensive external data check
     * Returns overall assessment and specific issues
     */
    static analyzeExternalData(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        externalData: ExternalData,
        config: {
            liqAvoidDistance?: number;
            liqIntensityThreshold?: number;
            maxSpreadPercent?: number;
            minOrderBookDepth?: number;
            imbalanceThreshold?: number;
            avoidAfterLargeOrder?: number;
            largeOrderThreshold?: number;
        }
    ): { safe: boolean; issues: string[]; warnings: string[] } {
        const issues: string[] = [];
        const warnings: string[] = [];

        // Check liquidations
        if (externalData.liquidations && config.liqAvoidDistance && config.liqIntensityThreshold) {
            const liqCheck = this.isLiquidationSafe(
                side,
                entryPrice,
                externalData.liquidations,
                config.liqAvoidDistance,
                config.liqIntensityThreshold
            );

            if (!liqCheck.safe) {
                issues.push(liqCheck.reason!);
            }
        }

        // Check order book
        if (externalData.orderBook && config.maxSpreadPercent && config.minOrderBookDepth && config.imbalanceThreshold) {
            const obCheck = this.analyzeOrderBook(
                externalData.orderBook,
                config.maxSpreadPercent,
                config.minOrderBookDepth,
                config.imbalanceThreshold
            );

            if (!obCheck.tradeable) {
                issues.push(obCheck.reason!);
            } else if (obCheck.quality === 'GOOD') {
                warnings.push('Order book quality: GOOD (acceptable)');
            }
        }

        // Check large orders
        if (externalData.recentLargeOrders && config.avoidAfterLargeOrder && config.largeOrderThreshold) {
            const loCheck = this.isLargeOrderSafe(
                side,
                externalData.recentLargeOrders,
                config.avoidAfterLargeOrder,
                config.largeOrderThreshold
            );

            if (!loCheck.safe) {
                issues.push(loCheck.reason!);
            }
        }

        return {
            safe: issues.length === 0,
            issues,
            warnings
        };
    }
}
