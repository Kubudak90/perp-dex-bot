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
