// ═══════════════════════════════════════════════════════════════════════════
// TRADING STRATEGY
// Supertrend + EMA Filter + ADX Confirmation + Funding Filter
// Phase 6A: + Multi-Timeframe + Volume + Trading Hours
// Phase 6B: + Partial TP + Dynamic SL + Market Regime
// Phase 6C: + External Data (Liquidations, Order Book, Large Orders)
// ═══════════════════════════════════════════════════════════════════════════

import { Signal, Indicators, BotConfig, Position, ExternalData } from '../types';
import { TradingHoursManager } from '../utils/trading-hours';
import { ExternalDataAnalyzer } from '../utils/external-data';

export class TradingStrategy {
    private config: BotConfig;

    constructor(config: BotConfig) {
        this.config = config;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN SIGNAL GENERATION
    // ─────────────────────────────────────────────────────────────────────────
    generateSignal(
        indicators: Indicators,
        currentPosition: Position | null,
        currentPrice: number,
        externalData?: ExternalData
    ): Signal {

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 1: Volatility Regime Filter
        // Avoid trading in dead/chaotic markets
        // ═══════════════════════════════════════════════════════════════════════
        if (!this.isVolatilityOk(indicators.atrPercentile)) {
            // If we have a position, check if we should close it
            if (currentPosition) {
                return this.checkExitSignal(indicators, currentPosition, currentPrice);
            }
            return 'NONE';
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 2: Trend Filter (EMA 50 vs EMA 200)
        // Only trade in direction of major trend
        // ═══════════════════════════════════════════════════════════════════════
        const trendDirection = this.getTrendDirection(indicators);

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 3: ADX Filter
        // Only trade when trend strength exists (ADX > threshold)
        // ═══════════════════════════════════════════════════════════════════════
        if (!this.isTrendStrong(indicators.adx)) {
            if (currentPosition) {
                return this.checkExitSignal(indicators, currentPosition, currentPrice);
            }
            return 'NONE';
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 4: Funding Rate Filter (Optional)
        // Avoid positions against extreme funding
        // ═══════════════════════════════════════════════════════════════════════
        if (this.config.useFundingFilter && this.isExtremeFunding(indicators.fundingRate)) {
            // Extreme positive funding = avoid longs
            // Extreme negative funding = avoid shorts
            const fundingBias = indicators.fundingRate > 0 ? 'SHORT' : 'LONG';

            if (currentPosition && currentPosition.side !== fundingBias) {
                // Consider closing against-funding positions
                return 'CLOSE';
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 5: Supertrend Signal (Main Entry/Exit)
        // ═══════════════════════════════════════════════════════════════════════
        const supertrendSignal = indicators.supertrend.trend;

        // If we have a position
        if (currentPosition) {
            // Exit on Supertrend flip
            if (currentPosition.side === 'LONG' && supertrendSignal === 'SHORT') {
                return 'CLOSE';
            }
            if (currentPosition.side === 'SHORT' && supertrendSignal === 'LONG') {
                return 'CLOSE';
            }
            return 'NONE';
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 6: Phase 6A Additional Filters
        // ═══════════════════════════════════════════════════════════════════════

        // Market Regime Filter (Phase 6B)
        if (this.config.useMarketRegime && indicators.marketRegime) {
            const regime = indicators.marketRegime.regime;

            // Skip ranging markets if configured
            if (this.config.skipRangingMarkets && regime === 'RANGING') {
                if (currentPosition) {
                    return this.checkExitSignal(indicators, currentPosition, currentPrice);
                }
                return 'NONE';
            }

            // Skip quiet markets (very low volatility)
            if (regime === 'QUIET') {
                if (currentPosition) {
                    return this.checkExitSignal(indicators, currentPosition, currentPrice);
                }
                return 'NONE';
            }

            // Note: VOLATILE regime will be handled in position sizing (reduce size)
        }

        // Trading Hours Filter
        if (this.config.useTradingHours) {
            const allowedSessions = this.config.allowedSessions || ['NY', 'LONDON'];
            const avoidWeekends = this.config.avoidWeekends !== false;

            if (!TradingHoursManager.isTradingAllowed(allowedSessions, avoidWeekends)) {
                // Not in allowed trading hours - only check exits
                if (currentPosition) {
                    return this.checkExitSignal(indicators, currentPosition, currentPrice);
                }
                return 'NONE';
            }
        }

        // Volume Filter
        if (this.config.useVolumeFilter && indicators.volume) {
            // Reject abnormal volume (potential manipulation)
            if (this.config.volumeRejectSurge && indicators.volume.isAbnormal) {
                if (currentPosition) {
                    return this.checkExitSignal(indicators, currentPosition, currentPrice);
                }
                return 'NONE';
            }

            // Require minimum volume
            const minRatio = this.config.volumeMinRatio || 0.8;
            if (indicators.volume.ratio < minRatio) {
                if (currentPosition) {
                    return this.checkExitSignal(indicators, currentPosition, currentPrice);
                }
                return 'NONE';
            }
        }

        // Multi-Timeframe Filter
        if (this.config.useMultiTimeframe && indicators.mtf) {
            const signal = supertrendSignal;

            // Require 1h trend alignment
            if (this.config.mtfRequire1hTrend && indicators.mtf.trend1h !== 'NEUTRAL') {
                const aligned1h = (signal === 'LONG' && indicators.mtf.trend1h === 'LONG') ||
                                  (signal === 'SHORT' && indicators.mtf.trend1h === 'SHORT');

                if (!aligned1h) {
                    if (currentPosition) {
                        return this.checkExitSignal(indicators, currentPosition, currentPrice);
                    }
                    return 'NONE';
                }
            }

            // Require 4h trend alignment
            if (this.config.mtfRequire4hTrend && indicators.mtf.trend4h !== 'NEUTRAL') {
                const aligned4h = (signal === 'LONG' && indicators.mtf.trend4h === 'LONG') ||
                                  (signal === 'SHORT' && indicators.mtf.trend4h === 'SHORT');

                if (!aligned4h) {
                    if (currentPosition) {
                        return this.checkExitSignal(indicators, currentPosition, currentPrice);
                    }
                    return 'NONE';
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 7: Phase 6C External Data Filters
        // ═══════════════════════════════════════════════════════════════════════

        if (externalData) {
            const externalCheck = ExternalDataAnalyzer.analyzeExternalData(
                supertrendSignal,
                currentPrice,
                externalData,
                {
                    liqAvoidDistance: this.config.useLiquidationData ? this.config.liqAvoidDistance : undefined,
                    liqIntensityThreshold: this.config.useLiquidationData ? this.config.liqIntensityThreshold : undefined,
                    maxSpreadPercent: this.config.useOrderBookData ? this.config.maxSpreadPercent : undefined,
                    minOrderBookDepth: this.config.useOrderBookData ? this.config.minOrderBookDepth : undefined,
                    imbalanceThreshold: this.config.useOrderBookData ? this.config.imbalanceThreshold : undefined,
                    avoidAfterLargeOrder: this.config.useLargeOrderTracking ? this.config.avoidAfterLargeOrder : undefined,
                    largeOrderThreshold: this.config.useLargeOrderTracking ? this.config.largeOrderThreshold : undefined
                }
            );

            if (!externalCheck.safe) {
                // External data indicates unfavorable conditions
                if (currentPosition) {
                    return this.checkExitSignal(indicators, currentPosition, currentPrice);
                }
                return 'NONE';
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 8: Entry Conditions
        // All filters must align
        // ═══════════════════════════════════════════════════════════════════════

        // LONG Entry
        if (
            supertrendSignal === 'LONG' &&
            trendDirection === 'BULLISH' &&
            currentPrice > indicators.supertrend.value
        ) {
            return 'LONG';
        }

        // SHORT Entry
        if (
            supertrendSignal === 'SHORT' &&
            trendDirection === 'BEARISH' &&
            currentPrice < indicators.supertrend.value
        ) {
            return 'SHORT';
        }

        return 'NONE';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER: Get trend direction from EMAs
    // ─────────────────────────────────────────────────────────────────────────
    private getTrendDirection(indicators: Indicators): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        const { ema50, ema200 } = indicators;

        if (ema50 > ema200) return 'BULLISH';
        if (ema50 < ema200) return 'BEARISH';
        return 'NEUTRAL';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER: Check if trend is strong enough (ADX)
    // ─────────────────────────────────────────────────────────────────────────
    private isTrendStrong(adx: number): boolean {
        return adx >= this.config.adxThreshold;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER: Check volatility regime
    // ─────────────────────────────────────────────────────────────────────────
    private isVolatilityOk(atrPercentile: number): boolean {
        return (
            atrPercentile >= this.config.minAtrPercentile &&
            atrPercentile <= this.config.maxAtrPercentile
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER: Check for extreme funding
    // ─────────────────────────────────────────────────────────────────────────
    private isExtremeFunding(fundingRate: number): boolean {
        return Math.abs(fundingRate) >= this.config.fundingThreshold;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER: Check exit conditions for existing position
    // ─────────────────────────────────────────────────────────────────────────
    private checkExitSignal(
        indicators: Indicators,
        position: Position,
        _currentPrice: number
    ): Signal {
        // Supertrend flip
        if (position.side === 'LONG' && indicators.supertrend.trend === 'SHORT') {
            return 'CLOSE';
        }
        if (position.side === 'SHORT' && indicators.supertrend.trend === 'LONG') {
            return 'CLOSE';
        }
        return 'NONE';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE STOP LOSS & TAKE PROFIT
    // ATR-based dynamic SL/TP (Phase 6B: Dynamic SL based on volatility)
    // ─────────────────────────────────────────────────────────────────────────
    calculateSLTP(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        atr: number,
        atrPercentile?: number
    ): { stopLoss: number; takeProfit: number; partialTpLevels?: { level1: number; level2: number; level3: number } } {
        // Phase 6B: Dynamic SL multiplier based on volatility
        let slMultiplier = this.config.risk.stopLossAtrMultiplier;

        if (this.config.useDynamicSl && atrPercentile !== undefined) {
            // Low volatility (<30th percentile): tighter SL
            // High volatility (>70th percentile): wider SL
            if (atrPercentile < 30) {
                slMultiplier = this.config.slMultiplierLow || 1.0;
            } else if (atrPercentile > 70) {
                slMultiplier = this.config.slMultiplierHigh || 2.0;
            }
            // else: use default multiplier
        }

        const slDistance = atr * slMultiplier;
        const tpDistance = slDistance * this.config.risk.riskRewardRatio;

        let result: { stopLoss: number; takeProfit: number; partialTpLevels?: { level1: number; level2: number; level3: number } };

        if (side === 'LONG') {
            result = {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };

            // Phase 6B: Partial TP levels
            if (this.config.usePartialTp && this.config.partialTpLevels) {
                const level1Distance = slDistance * (this.config.partialTpLevels.level1?.rrRatio || 1.0);
                const level2Distance = slDistance * (this.config.partialTpLevels.level2?.rrRatio || 1.5);
                const level3Distance = slDistance * (this.config.partialTpLevels.level3?.rrRatio || 2.0);

                result.partialTpLevels = {
                    level1: entryPrice + level1Distance,
                    level2: entryPrice + level2Distance,
                    level3: entryPrice + level3Distance
                };
            }
        } else {
            result = {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };

            // Phase 6B: Partial TP levels
            if (this.config.usePartialTp && this.config.partialTpLevels) {
                const level1Distance = slDistance * (this.config.partialTpLevels.level1?.rrRatio || 1.0);
                const level2Distance = slDistance * (this.config.partialTpLevels.level2?.rrRatio || 1.5);
                const level3Distance = slDistance * (this.config.partialTpLevels.level3?.rrRatio || 2.0);

                result.partialTpLevels = {
                    level1: entryPrice - level1Distance,
                    level2: entryPrice - level2Distance,
                    level3: entryPrice - level3Distance
                };
            }
        }

        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK PARTIAL TP LEVELS (Phase 6B)
    // Returns which partial TP level was hit, if any
    // ─────────────────────────────────────────────────────────────────────────
    checkPartialTP(
        position: Position,
        currentPrice: number,
        partialTpLevels?: { level1: number; level2: number; level3: number }
    ): { hit: boolean; level: number } | null {
        if (!partialTpLevels || !position.partialTpLevels) {
            return null;
        }

        const hitLevels = position.partialTpLevels || [];

        if (position.side === 'LONG') {
            // Check level 3 first (highest)
            if (!hitLevels.includes(3) && currentPrice >= partialTpLevels.level3) {
                return { hit: true, level: 3 };
            }
            if (!hitLevels.includes(2) && currentPrice >= partialTpLevels.level2) {
                return { hit: true, level: 2 };
            }
            if (!hitLevels.includes(1) && currentPrice >= partialTpLevels.level1) {
                return { hit: true, level: 1 };
            }
        } else {
            // SHORT position
            if (!hitLevels.includes(3) && currentPrice <= partialTpLevels.level3) {
                return { hit: true, level: 3 };
            }
            if (!hitLevels.includes(2) && currentPrice <= partialTpLevels.level2) {
                return { hit: true, level: 2 };
            }
            if (!hitLevels.includes(1) && currentPrice <= partialTpLevels.level1) {
                return { hit: true, level: 1 };
            }
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE POSITION SIZE ADJUSTMENT (Phase 6B)
    // Adjusts position size based on market regime
    // ─────────────────────────────────────────────────────────────────────────
    calculatePositionSizeMultiplier(marketRegime?: { regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'QUIET'; confidence: number }): number {
        if (!this.config.useMarketRegime || !marketRegime) {
            return 1.0; // No adjustment
        }

        // Reduce position size in volatile markets
        if (this.config.reduceInVolatile && marketRegime.regime === 'VOLATILE') {
            return this.config.volatileReduction || 0.5; // Default: 50% size
        }

        return 1.0; // Full size in normal conditions
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEBUG: Get strategy state as string
    // ─────────────────────────────────────────────────────────────────────────
    getStateDebug(indicators: Indicators): string {
        return `
    ┌─────────────────────────────────────────┐
    │ STRATEGY STATE                          │
    ├─────────────────────────────────────────┤
    │ Supertrend: ${indicators.supertrend.trend.padEnd(6)} @ ${indicators.supertrend.value.toFixed(2)}
    │ EMA50/200:  ${indicators.ema50.toFixed(2)} / ${indicators.ema200.toFixed(2)}
    │ Trend:      ${this.getTrendDirection(indicators)}
    │ ADX:        ${indicators.adx.toFixed(2)} (threshold: ${this.config.adxThreshold})
    │ ATR:        ${indicators.atr.toFixed(4)}
    │ Volatility: ${indicators.atrPercentile.toFixed(1)}th percentile
    │ Funding:    ${(indicators.fundingRate * 100).toFixed(4)}%
    └─────────────────────────────────────────┘`;
    }
}
