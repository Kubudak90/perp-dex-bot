// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// All interfaces and types for the Perp DEX Bot
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// CANDLE DATA
// ─────────────────────────────────────────────────────────────────────────
export interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// ─────────────────────────────────────────────────────────────────────────
// MARKET DATA
// ─────────────────────────────────────────────────────────────────────────
export interface MarketData {
    symbol: string;
    markPrice: number;
    indexPrice: number;
    fundingRate: number;
    openInterest: number;
    volume24h: number;
}

// ─────────────────────────────────────────────────────────────────────────
// POSITION
// ─────────────────────────────────────────────────────────────────────────
export interface Position {
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    size: number;
    stopLoss: number;
    takeProfit: number;
    entryTime: number;
    unrealizedPnl: number;
    // Phase 6B: Partial TP tracking
    initialSize?: number;           // Original position size
    partialTpLevels?: number[];     // TP levels hit (e.g., [1, 2])
    remainingSize?: number;         // Current position size after partials
    peakPrice?: number;             // Peak price for trailing stop
}

// ─────────────────────────────────────────────────────────────────────────
// TRADE RESULT
// ─────────────────────────────────────────────────────────────────────────
export interface TradeResult {
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    duration: number;
    exitReason: 'SL' | 'TP' | 'SIGNAL';
}

// ─────────────────────────────────────────────────────────────────────────
// SIGNAL TYPES
// ─────────────────────────────────────────────────────────────────────────
export type Signal = 'LONG' | 'SHORT' | 'CLOSE' | 'NONE';

// ─────────────────────────────────────────────────────────────────────────
// SUPERTREND RESULT
// ─────────────────────────────────────────────────────────────────────────
export interface SupertrendResult {
    trend: 'LONG' | 'SHORT';
    value: number;
    upperBand: number;
    lowerBand: number;
}

// ─────────────────────────────────────────────────────────────────────────
// MARKET REGIME
// ─────────────────────────────────────────────────────────────────────────
export type MarketRegime = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'QUIET';

// ─────────────────────────────────────────────────────────────────────────
// INDICATORS
// ─────────────────────────────────────────────────────────────────────────
export interface Indicators {
    supertrend: SupertrendResult;
    ema50: number;
    ema200: number;
    adx: number;
    atr: number;
    fundingRate: number;
    atrPercentile: number;
    // Phase 6A: Multi-timeframe
    mtf?: {
        trend1h: 'LONG' | 'SHORT' | 'NEUTRAL'; // 1h EMA trend
        trend4h: 'LONG' | 'SHORT' | 'NEUTRAL'; // 4h EMA trend
        ema50_1h?: number;
        ema200_1h?: number;
        ema50_4h?: number;
        ema200_4h?: number;
    };
    // Phase 6A: Volume
    volume?: {
        current: number;
        sma20: number;               // 20-period volume SMA
        ratio: number;               // current / sma20
        isSurge: boolean;            // volume > 2x SMA
        isAbnormal: boolean;         // volume > 5x SMA (skip entry)
    };
    // Phase 6B: Market Regime
    marketRegime?: {
        regime: MarketRegime;        // Current market state
        adxTrend: number;            // ADX for trend strength
        atrVolatility: number;       // ATR for volatility
        confidence: number;          // Confidence score (0-1)
    };
}

// ─────────────────────────────────────────────────────────────────────────
// RISK CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────
export interface RiskConfig {
    maxPositionSize: number;      // Max % of equity per trade
    maxDailyLoss: number;         // Max daily loss %
    maxDailyTrades: number;       // Max trades per day
    riskRewardRatio: number;      // Risk/Reward ratio (e.g., 1.5 = 1:1.5)
    stopLossAtrMultiplier: number; // SL = ATR * multiplier
    cooldownMinutes: number;      // Cooldown after loss
    // Advanced features
    useTrailingStop?: boolean;    // Enable trailing stop loss
    trailingStopDistance?: number; // Distance in % from peak
    maxConsecutiveLosses?: number; // Max consecutive losses before pause
    maxPortfolioHeat?: number;    // Max % of equity at risk across all positions
    maxHoldTimeHours?: number;    // Force close after X hours
}

// ─────────────────────────────────────────────────────────────────────────
// BOT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────
export interface BotConfig {
    // Trading pair
    symbol: string;
    timeframe: string;
    leverage: number;

    // Supertrend settings
    supertrendPeriod: number;
    supertrendMultiplier: number;

    // EMA settings
    emaFastPeriod: number;
    emaSlowPeriod: number;

    // ADX settings
    adxPeriod: number;
    adxThreshold: number;

    // Funding settings
    fundingThreshold: number;
    useFundingFilter: boolean;

    // Volatility regime
    atrPeriod: number;
    atrLookback: number;
    minAtrPercentile: number;
    maxAtrPercentile: number;

    // Phase 6A: Multi-Timeframe Confirmation
    useMultiTimeframe?: boolean;      // Enable MTF confirmation
    mtfRequire1hTrend?: boolean;      // Require 1h trend alignment
    mtfRequire4hTrend?: boolean;      // Require 4h trend alignment

    // Phase 6A: Volume Filters
    useVolumeFilter?: boolean;        // Enable volume filters
    volumeMinRatio?: number;          // Min volume/SMA ratio (e.g., 0.8)
    volumeRejectSurge?: boolean;      // Reject abnormal volume spikes (> 5x)

    // Phase 6A: Trading Hours
    useTradingHours?: boolean;        // Enable session filtering
    allowedSessions?: ('NY' | 'LONDON' | 'ASIA')[];  // Allowed sessions
    avoidWeekends?: boolean;          // Skip weekend trading

    // Phase 6B: Partial Profit Taking
    usePartialTp?: boolean;           // Enable scale-out exits
    partialTpLevels?: {               // TP levels for scaling out
        level1?: { rrRatio: number; closePercent: number };  // e.g., 1:1, close 50%
        level2?: { rrRatio: number; closePercent: number };  // e.g., 1.5:1, close 30%
        level3?: { rrRatio: number; closePercent: number };  // e.g., 2:1, close 20%
    };

    // Phase 6B: Dynamic Stop Loss
    useDynamicSl?: boolean;           // Enable volatility-based SL
    slMultiplierLow?: number;         // SL multiplier in low volatility (e.g., 1.0)
    slMultiplierHigh?: number;        // SL multiplier in high volatility (e.g., 2.0)

    // Phase 6B: Market Regime
    useMarketRegime?: boolean;        // Enable regime filtering
    skipRangingMarkets?: boolean;     // Skip trades in ranging markets
    reduceInVolatile?: boolean;       // Reduce position size in volatile markets
    volatileReduction?: number;       // Position reduction % (e.g., 0.5 = 50%)

    // Risk management
    risk: RiskConfig;
}

// ─────────────────────────────────────────────────────────────────────────
// BOT STATE
// ─────────────────────────────────────────────────────────────────────────
export interface BotState {
    position: Position | null;
    dailyPnl: number;
    dailyTrades: number;
    lastTradeTime: number;
    lastLossTime: number;
    isActive: boolean;
    equity: number;
    trades: TradeResult[];
    // Advanced tracking
    consecutiveLosses?: number;    // Track consecutive losing trades
    peakPrice?: number;            // Peak price since entry (for trailing stop)
    portfolioHeat?: number;        // Current risk across all positions
}

// ─────────────────────────────────────────────────────────────────────────
// ORDER RESULT
// ─────────────────────────────────────────────────────────────────────────
export interface OrderResult {
    orderId: string;
    avgPrice: number;
    filledSize?: number;
    status?: 'filled' | 'partial' | 'cancelled';
}
