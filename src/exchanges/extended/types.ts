// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED EXCHANGE TYPES
// Starknet-specific types for Extended perpetual DEX
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended Market Information
 */
export interface ExtendedMarket {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    minOrderSize: number;
    maxOrderSize: number;
    tickSize: number;
    contractAddress: string;
}

/**
 * Extended Order Response
 */
export interface ExtendedOrder {
    orderId: string;
    clientOrderId?: string;
    symbol: string;
    side: 'LONG' | 'SHORT';
    type: 'MARKET' | 'LIMIT';
    price: number;
    size: number;
    filledSize: number;
    avgPrice: number;
    status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED';
    timestamp: number;
    txHash?: string;
}

/**
 * Extended Position Response
 */
export interface ExtendedPosition {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    markPrice: number;
    liquidationPrice: number;
    unrealizedPnl: number;
    leverage: number;
    margin: number;
}

/**
 * Extended Account State
 */
export interface ExtendedAccount {
    address: string;
    balance: number;
    availableBalance: number;
    marginUsed: number;
    unrealizedPnl: number;
    totalPositionValue: number;
}

/**
 * Extended Points/Rewards System
 */
export interface ExtendedPoints {
    totalPoints: number;
    tradingPoints: number;      // Points from trading volume
    liquidityPoints: number;    // Points from maker orders
    referralPoints: number;     // Points from referrals
    season: number;             // Current season
    rank?: number;              // Leaderboard rank
    estimatedReward?: number;   // Estimated $ value
}

/**
 * Extended API Response Wrapper
 */
export interface ExtendedResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

/**
 * Extended WebSocket Message
 */
export interface ExtendedWsMessage {
    type: 'price' | 'position' | 'order' | 'account';
    symbol?: string;
    data: any;
    timestamp: number;
}

/**
 * Extended Fee Structure
 */
export interface ExtendedFees {
    maker: number;      // 0.0002 (0.02%)
    taker: number;      // 0.0005 (0.05%)
}

/**
 * Extended API Endpoints
 */
export const EXTENDED_ENDPOINTS = {
    MAINNET: 'https://api.extended.exchange',
    TESTNET: 'https://testnet-api.extended.exchange',
    WS_MAINNET: 'wss://ws.extended.exchange',
    WS_TESTNET: 'wss://testnet-ws.extended.exchange',
};

/**
 * Extended Contract Addresses (Starknet)
 */
export const EXTENDED_CONTRACTS = {
    MAINNET: {
        CLEARINGHOUSE: '0x...', // TODO: Get actual contract address
        USDC: '0x...', // TODO: Get actual USDC contract
    },
    TESTNET: {
        CLEARINGHOUSE: '0x...', // TODO: Get actual testnet contract
        USDC: '0x...', // TODO: Get actual testnet USDC
    },
};
