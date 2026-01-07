// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED CONFIGURATION
// Trading parameters and fee structure for Extended exchange
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended Fee Structure
 * Source: https://docs.extended.exchange/fees
 */
export const EXTENDED_FEES = {
    maker: 0.0002,  // 0.02% - Maker orders (limit orders)
    taker: 0.0005,  // 0.05% - Taker orders (market orders)
};

/**
 * Extended Trading Configuration
 * Optimized for airdrop farming + profit
 */
export const EXTENDED_CONFIG = {
    fees: EXTENDED_FEES,

    slippage: {
        baseSlippage: 0.0001,       // 0.01% base slippage
        volumeImpact: 0.000001,     // Low impact due to good liquidity
        liquidityFactor: 0.8,       // Decent liquidity (0-1, higher is better)
    },

    risk: {
        maxPositionSize: 0.05,      // 5% of equity per trade
        maxDailyLoss: 0.02,         // 2% max daily loss
        maxDailyTrades: 20,         // 20 trades/day for volume farming
        riskRewardRatio: 1.5,       // 1:1.5 risk/reward
        stopLossAtrMultiplier: 1.5, // SL = 1.5 * ATR
        cooldownMinutes: 5,         // 5 min cooldown after loss
    },

    limits: {
        minOrderSize: 0.001,        // Min order size (varies by market)
        maxOrderSize: 1000,         // Max order size
        maxLeverage: 20,            // Extended supports up to 20x
    },

    points: {
        tradingVolumeMultiplier: 1, // Points per $1 volume
        makerBonus: 1.5,            // 1.5x points for maker orders
        estimatedPointValue: 6,     // $6 OTC per point (Season 1)
    },

    airdrop: {
        season: 1,
        endDate: new Date('2026-03-31'), // Q1 2026 estimate
        targetTrades: 1000,              // Target for max rewards
        targetVolume: 1000000,           // $1M volume target
    },
};

/**
 * Extended Supported Markets
 */
export const EXTENDED_MARKETS = [
    'BTC-USD',
    'ETH-USD',
    'SOL-USD',
    'ARB-USD',
    'OP-USD',
    // Add more as needed
];

/**
 * Get optimal leverage based on volatility
 */
export function getOptimalLeverage(atrPercent: number): number {
    if (atrPercent > 5) return 5;      // High volatility: 5x
    if (atrPercent > 3) return 10;     // Medium volatility: 10x
    return 15;                          // Low volatility: 15x
}

/**
 * Calculate position size for optimal points/trade ratio
 */
export function calculateOptimalSize(
    equity: number,
    risk: number,
    atr: number,
    price: number
): number {
    const riskAmount = equity * risk;
    const size = riskAmount / (atr * EXTENDED_CONFIG.risk.stopLossAtrMultiplier);

    // Clamp to limits
    return Math.max(
        EXTENDED_CONFIG.limits.minOrderSize,
        Math.min(size, EXTENDED_CONFIG.limits.maxOrderSize)
    );
}
