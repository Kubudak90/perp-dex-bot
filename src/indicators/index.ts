// ═══════════════════════════════════════════════════════════════════════════
// INDICATOR CALCULATIONS
// Supertrend, EMA, ADX, ATR + Volatility Regime
// ═══════════════════════════════════════════════════════════════════════════

import { Candle, SupertrendResult, Indicators, BotConfig } from '../types';

export class IndicatorCalculator {

    // ─────────────────────────────────────────────────────────────────────────
    // ATR (Average True Range)
    // ─────────────────────────────────────────────────────────────────────────
    static calculateATR(candles: Candle[], period: number): number[] {
        const atrValues: number[] = [];
        const trueRanges: number[] = [];

        for (let i = 0; i < candles.length; i++) {
            if (i === 0) {
                trueRanges.push(candles[i].high - candles[i].low);
            } else {
                const tr = Math.max(
                    candles[i].high - candles[i].low,
                    Math.abs(candles[i].high - candles[i - 1].close),
                    Math.abs(candles[i].low - candles[i - 1].close)
                );
                trueRanges.push(tr);
            }

            if (i < period - 1) {
                atrValues.push(0);
            } else if (i === period - 1) {
                const sum = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
                atrValues.push(sum / period);
            } else {
                // Wilder's smoothing
                const prevAtr = atrValues[atrValues.length - 1];
                atrValues.push((prevAtr * (period - 1) + trueRanges[i]) / period);
            }
        }

        return atrValues;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EMA (Exponential Moving Average)
    // ─────────────────────────────────────────────────────────────────────────
    static calculateEMA(values: number[], period: number): number[] {
        const emaValues: number[] = [];
        const multiplier = 2 / (period + 1);

        for (let i = 0; i < values.length; i++) {
            if (i < period - 1) {
                emaValues.push(0);
            } else if (i === period - 1) {
                const sum = values.slice(0, period).reduce((a, b) => a + b, 0);
                emaValues.push(sum / period);
            } else {
                const prevEma = emaValues[emaValues.length - 1];
                emaValues.push((values[i] - prevEma) * multiplier + prevEma);
            }
        }

        return emaValues;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUPERTREND
    // Kıvanç Özbilgiç's famous indicator - ATR based trend follower
    // ─────────────────────────────────────────────────────────────────────────
    static calculateSupertrend(
        candles: Candle[],
        period: number,
        multiplier: number
    ): SupertrendResult[] {
        const atr = this.calculateATR(candles, period);
        const results: SupertrendResult[] = [];

        let prevUpperBand = 0;
        let prevLowerBand = 0;
        let prevTrend: 'LONG' | 'SHORT' = 'LONG';
        let prevSupertrend = 0;

        for (let i = 0; i < candles.length; i++) {
            const hl2 = (candles[i].high + candles[i].low) / 2;
            const atrValue = atr[i];

            let upperBand = hl2 + (multiplier * atrValue);
            let lowerBand = hl2 - (multiplier * atrValue);

            // Band adjustments (key to Supertrend's smoothness)
            if (i > 0) {
                if (lowerBand > prevLowerBand || candles[i - 1].close < prevLowerBand) {
                    // Keep lower band
                } else {
                    lowerBand = prevLowerBand;
                }

                if (upperBand < prevUpperBand || candles[i - 1].close > prevUpperBand) {
                    // Keep upper band
                } else {
                    upperBand = prevUpperBand;
                }
            }

            // Trend determination
            let trend: 'LONG' | 'SHORT';
            let supertrendValue: number;

            if (i === 0) {
                trend = 'LONG';
                supertrendValue = lowerBand;
            } else {
                if (prevTrend === 'LONG') {
                    if (candles[i].close < prevLowerBand) {
                        trend = 'SHORT';
                        supertrendValue = upperBand;
                    } else {
                        trend = 'LONG';
                        supertrendValue = lowerBand;
                    }
                } else {
                    if (candles[i].close > prevUpperBand) {
                        trend = 'LONG';
                        supertrendValue = lowerBand;
                    } else {
                        trend = 'SHORT';
                        supertrendValue = upperBand;
                    }
                }
            }

            results.push({
                trend,
                value: supertrendValue,
                upperBand,
                lowerBand
            });

            prevUpperBand = upperBand;
            prevLowerBand = lowerBand;
            prevTrend = trend;
            prevSupertrend = supertrendValue;
        }

        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADX (Average Directional Index)
    // Trend strength indicator - above 20/25 = trend exists
    // ─────────────────────────────────────────────────────────────────────────
    static calculateADX(candles: Candle[], period: number): number[] {
        const adxValues: number[] = [];
        const plusDM: number[] = [];
        const minusDM: number[] = [];
        const tr: number[] = [];

        // Calculate +DM, -DM, TR
        for (let i = 0; i < candles.length; i++) {
            if (i === 0) {
                plusDM.push(0);
                minusDM.push(0);
                tr.push(candles[i].high - candles[i].low);
            } else {
                const upMove = candles[i].high - candles[i - 1].high;
                const downMove = candles[i - 1].low - candles[i].low;

                plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
                minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

                tr.push(Math.max(
                    candles[i].high - candles[i].low,
                    Math.abs(candles[i].high - candles[i - 1].close),
                    Math.abs(candles[i].low - candles[i - 1].close)
                ));
            }
        }

        // Smooth the values using Wilder's method
        const smoothedPlusDM = this.wilderSmooth(plusDM, period);
        const smoothedMinusDM = this.wilderSmooth(minusDM, period);
        const smoothedTR = this.wilderSmooth(tr, period);

        // Calculate +DI, -DI
        const plusDI: number[] = [];
        const minusDI: number[] = [];

        for (let i = 0; i < candles.length; i++) {
            if (smoothedTR[i] === 0) {
                plusDI.push(0);
                minusDI.push(0);
            } else {
                plusDI.push((smoothedPlusDM[i] / smoothedTR[i]) * 100);
                minusDI.push((smoothedMinusDM[i] / smoothedTR[i]) * 100);
            }
        }

        // Calculate DX
        const dx: number[] = [];
        for (let i = 0; i < candles.length; i++) {
            const sum = plusDI[i] + minusDI[i];
            if (sum === 0) {
                dx.push(0);
            } else {
                dx.push((Math.abs(plusDI[i] - minusDI[i]) / sum) * 100);
            }
        }

        // Smooth DX to get ADX
        const adx = this.wilderSmooth(dx, period);
        return adx;
    }

    private static wilderSmooth(values: number[], period: number): number[] {
        const smoothed: number[] = [];

        for (let i = 0; i < values.length; i++) {
            if (i < period - 1) {
                smoothed.push(0);
            } else if (i === period - 1) {
                const sum = values.slice(0, period).reduce((a, b) => a + b, 0);
                smoothed.push(sum / period);
            } else {
                const prev = smoothed[smoothed.length - 1];
                smoothed.push((prev * (period - 1) + values[i]) / period);
            }
        }

        return smoothed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATR PERCENTILE (Volatility Regime Detection)
    // Low percentile = sideways/chop, High = trending
    // ─────────────────────────────────────────────────────────────────────────
    static calculateATRPercentile(
        atrValues: number[],
        currentATR: number,
        lookback: number
    ): number {
        const recentATR = atrValues.slice(-lookback);
        if (recentATR.length === 0) return 50;

        const sorted = [...recentATR].sort((a, b) => a - b);
        let rank = 0;

        for (const val of sorted) {
            if (currentATR > val) rank++;
        }

        return (rank / sorted.length) * 100;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET ALL INDICATORS
    // Main function - returns complete indicator set for decision making
    // ─────────────────────────────────────────────────────────────────────────
    static getIndicators(
        candles: Candle[],
        config: BotConfig,
        fundingRate: number
    ): Indicators {
        const closes = candles.map(c => c.close);

        // Calculate all indicators
        const supertrend = this.calculateSupertrend(
            candles,
            config.supertrendPeriod,
            config.supertrendMultiplier
        );

        const ema50 = this.calculateEMA(closes, config.emaFastPeriod);
        const ema200 = this.calculateEMA(closes, config.emaSlowPeriod);
        const adx = this.calculateADX(candles, config.adxPeriod);
        const atr = this.calculateATR(candles, config.atrPeriod);

        const lastIndex = candles.length - 1;
        const currentATR = atr[lastIndex];
        const atrPercentile = this.calculateATRPercentile(atr, currentATR, config.atrLookback);

        return {
            supertrend: supertrend[lastIndex],
            ema50: ema50[lastIndex],
            ema200: ema200[lastIndex],
            adx: adx[lastIndex],
            atr: currentATR,
            fundingRate,
            atrPercentile
        };
    }
}
