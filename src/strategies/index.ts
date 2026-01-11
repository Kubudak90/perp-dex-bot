// ═══════════════════════════════════════════════════════════════════════════
// TRADING STRATEGY
// Supertrend + EMA Filter + ADX Confirmation + Funding Filter
// Phase 6A: + Multi-Timeframe + Volume + Trading Hours
// ═══════════════════════════════════════════════════════════════════════════

import { Signal, Indicators, BotConfig, Position } from '../types';
import { TradingHoursManager } from '../utils/trading-hours';

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
        currentPrice: number
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
        // STEP 7: Entry Conditions
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
    // ATR-based dynamic SL/TP
    // ─────────────────────────────────────────────────────────────────────────
    calculateSLTP(
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        atr: number
    ): { stopLoss: number; takeProfit: number } {
        const slDistance = atr * this.config.risk.stopLossAtrMultiplier;
        const tpDistance = slDistance * this.config.risk.riskRewardRatio;

        if (side === 'LONG') {
            return {
                stopLoss: entryPrice - slDistance,
                takeProfit: entryPrice + tpDistance
            };
        } else {
            return {
                stopLoss: entryPrice + slDistance,
                takeProfit: entryPrice - tpDistance
            };
        }
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
