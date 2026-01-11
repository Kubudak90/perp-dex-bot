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
        }

        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADX (Average Directional Index)
    // Trend strength indicator - above 20/25 = trend exists
    // ─────────────────────────────────────────────────────────────────────────
    static calculateADX(candles: Candle[], period: number): number[] {
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
    // VOLUME ANALYSIS (Phase 6A)
    // ─────────────────────────────────────────────────────────────────────────
    static calculateVolumeMetrics(candles: Candle[], period: number = 20): {
        current: number;
        sma20: number;
        ratio: number;
        isSurge: boolean;
        isAbnormal: boolean;
    } {
        const volumes = candles.map(c => c.volume);
        const current = volumes[volumes.length - 1];

        // Calculate volume SMA
        const recentVolumes = volumes.slice(-period);
        const sma20 = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

        const ratio = current / sma20;
        const isSurge = ratio > 2.0;      // Volume > 2x average = surge
        const isAbnormal = ratio > 5.0;   // Volume > 5x average = abnormal (potential manipulation)

        return { current, sma20, ratio, isSurge, isAbnormal };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MULTI-TIMEFRAME TREND (Phase 6A)
    // Analyzes higher timeframe trends for confirmation
    // ─────────────────────────────────────────────────────────────────────────
    static calculateMultiTimeframeTrend(
        candles: Candle[],
        currentTimeframe: string,
        emaFastPeriod: number,
        emaSlowPeriod: number
    ): {
        trend1h: 'LONG' | 'SHORT' | 'NEUTRAL';
        trend4h: 'LONG' | 'SHORT' | 'NEUTRAL';
        ema50_1h?: number;
        ema200_1h?: number;
        ema50_4h?: number;
        ema200_4h?: number;
    } {
        // Timeframe conversion ratios
        const tfMultipliers: Record<string, { to1h: number; to4h: number }> = {
            '1m': { to1h: 60, to4h: 240 },
            '5m': { to1h: 12, to4h: 48 },
            '15m': { to1h: 4, to4h: 16 },
            '30m': { to1h: 2, to4h: 8 },
            '1h': { to1h: 1, to4h: 4 },
            '4h': { to1h: 0, to4h: 1 }
        };

        const multipliers = tfMultipliers[currentTimeframe] || { to1h: 4, to4h: 16 };

        // Sample candles for higher timeframes
        const sample1h = this.sampleCandles(candles, multipliers.to1h);
        const sample4h = this.sampleCandles(candles, multipliers.to4h);

        let trend1h: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
        let trend4h: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
        let ema50_1h, ema200_1h, ema50_4h, ema200_4h;

        // Calculate 1h trend if possible
        if (sample1h.length >= emaSlowPeriod) {
            const closes1h = sample1h.map(c => c.close);
            const ema50_1h_arr = this.calculateEMA(closes1h, emaFastPeriod);
            const ema200_1h_arr = this.calculateEMA(closes1h, emaSlowPeriod);

            ema50_1h = ema50_1h_arr[ema50_1h_arr.length - 1];
            ema200_1h = ema200_1h_arr[ema200_1h_arr.length - 1];

            if (ema50_1h > ema200_1h * 1.001) trend1h = 'LONG';
            else if (ema50_1h < ema200_1h * 0.999) trend1h = 'SHORT';
        }

        // Calculate 4h trend if possible
        if (sample4h.length >= emaSlowPeriod) {
            const closes4h = sample4h.map(c => c.close);
            const ema50_4h_arr = this.calculateEMA(closes4h, emaFastPeriod);
            const ema200_4h_arr = this.calculateEMA(closes4h, emaSlowPeriod);

            ema50_4h = ema50_4h_arr[ema50_4h_arr.length - 1];
            ema200_4h = ema200_4h_arr[ema200_4h_arr.length - 1];

            if (ema50_4h > ema200_4h * 1.001) trend4h = 'LONG';
            else if (ema50_4h < ema200_4h * 0.999) trend4h = 'SHORT';
        }

        return { trend1h, trend4h, ema50_1h, ema200_1h, ema50_4h, ema200_4h };
    }

    // Helper: Sample candles for higher timeframe
    private static sampleCandles(candles: Candle[], multiplier: number): Candle[] {
        if (multiplier <= 0 || multiplier === 1) return candles;

        const sampled: Candle[] = [];
        for (let i = multiplier - 1; i < candles.length; i += multiplier) {
            const batch = candles.slice(Math.max(0, i - multiplier + 1), i + 1);

            sampled.push({
                timestamp: batch[batch.length - 1].timestamp,
                open: batch[0].open,
                high: Math.max(...batch.map(c => c.high)),
                low: Math.min(...batch.map(c => c.low)),
                close: batch[batch.length - 1].close,
                volume: batch.reduce((sum, c) => sum + c.volume, 0)
            });
        }

        return sampled;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARKET REGIME DETECTION (Phase 6B)
    // Identifies market state: TRENDING, RANGING, VOLATILE, QUIET
    // ─────────────────────────────────────────────────────────────────────────
    static detectMarketRegime(
        adx: number,
        atrPercentile: number,
        adxThreshold: number = 25
    ): {
        regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'QUIET';
        adxTrend: number;
        atrVolatility: number;
        confidence: number;
    } {
        const adxTrend = adx;
        const atrVolatility = atrPercentile;

        // Decision matrix:
        // TRENDING: ADX > 25 && ATR in normal range (30-80)
        // RANGING: ADX < 20 && ATR in normal range
        // VOLATILE: ATR > 80 (regardless of ADX)
        // QUIET: ATR < 20 (regardless of ADX)

        let regime: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'QUIET';
        let confidence: number;

        // Priority: Volatility extremes first
        if (atrVolatility > 80) {
            regime = 'VOLATILE';
            confidence = Math.min((atrVolatility - 80) / 20, 1.0);
        } else if (atrVolatility < 20) {
            regime = 'QUIET';
            confidence = Math.min((20 - atrVolatility) / 20, 1.0);
        } else if (adx > adxThreshold) {
            regime = 'TRENDING';
            confidence = Math.min((adx - adxThreshold) / 30, 1.0);
        } else {
            regime = 'RANGING';
            confidence = Math.min((adxThreshold - adx) / adxThreshold, 1.0);
        }

        return {
            regime,
            adxTrend,
            atrVolatility,
            confidence: Math.max(0.3, confidence) // Min 30% confidence
        };
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

        // Phase 6A: Volume metrics
        const volume = config.useVolumeFilter
            ? this.calculateVolumeMetrics(candles)
            : undefined;

        // Phase 6A: Multi-timeframe confirmation
        const mtf = config.useMultiTimeframe
            ? this.calculateMultiTimeframeTrend(
                candles,
                config.timeframe,
                config.emaFastPeriod,
                config.emaSlowPeriod
            )
            : undefined;

        // Phase 6B: Market regime detection
        const marketRegime = config.useMarketRegime
            ? this.detectMarketRegime(adx[lastIndex], atrPercentile, config.adxThreshold)
            : undefined;

        return {
            supertrend: supertrend[lastIndex],
            ema50: ema50[lastIndex],
            ema200: ema200[lastIndex],
            adx: adx[lastIndex],
            atr: currentATR,
            fundingRate,
            atrPercentile,
            volume,
            mtf,
            marketRegime
        };
    }
}
