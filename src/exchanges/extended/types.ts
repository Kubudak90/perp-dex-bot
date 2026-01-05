// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED EXCHANGE TYPES
// Real API types based on Extended Exchange documentation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extended Configuration
 */
export interface ExtendedConfig {
    apiBaseUrl: string;
    streamUrl: string;
    signingDomain: string;
    collateralDecimals: number;
    starknetDomain: {
        name: string;
        version: string;
        chainId: string;
        revision: string;
    };
}

/**
 * Extended API Endpoints
 */
export const EXTENDED_MAINNET_CONFIG: ExtendedConfig = {
    apiBaseUrl: 'https://api.starknet.extended.exchange/api/v1',
    streamUrl: 'wss://api.starknet.extended.exchange/stream.extended.exchange/v1',
    signingDomain: 'extended.exchange',
    collateralDecimals: 6,
    starknetDomain: {
        name: 'Perpetuals',
        version: 'v0',
        chainId: 'SN_MAIN',
        revision: '1',
    },
};

export const EXTENDED_TESTNET_CONFIG: ExtendedConfig = {
    apiBaseUrl: 'https://api.starknet.sepolia.extended.exchange/api/v1',
    streamUrl: 'wss://starknet.sepolia.extended.exchange/stream.extended.exchange/v1',
    signingDomain: 'starknet.sepolia.extended.exchange',
    collateralDecimals: 6,
    starknetDomain: {
        name: 'Perpetuals',
        version: 'v0',
        chainId: 'SN_SEPOLIA',
        revision: '1',
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generic API Response
 */
export interface ApiResponse<T> {
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

/**
 * Paginated Response
 */
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKET DATA TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Market Information
 */
export interface Market {
    market: string;
    baseCurrency: string;
    quoteCurrency: string;
    minSize: string;
    maxSize: string;
    tickSize: string;
    indexPriceSource: string;
    oracleSource: string;
    initialMarginFraction: string;
    maintenanceMarginFraction: string;
    maxLeverage: string;
    makerFee: string;
    takerFee: string;
}

/**
 * Market Statistics
 */
export interface MarketStats {
    market: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    volumeQuote: string;
    priceChange: string;
    priceChangePercent: string;
    trades: number;
    fundingRate: string;
    nextFundingTime: number;
    openInterest: string;
}

/**
 * Order Book
 */
export interface OrderBook {
    market: string;
    timestamp: number;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

export interface OrderBookLevel {
    price: string;
    size: string;
    count: number;
}

/**
 * Public Trade
 */
export interface Trade {
    id: number;
    market: string;
    price: string;
    size: string;
    side: 'BUY' | 'SELL';
    timestamp: number;
}

/**
 * Candle Data
 */
export interface Candle {
    timestamp: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
}

/**
 * Funding Rate
 */
export interface FundingRate {
    market: string;
    rate: string;
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCOUNT & BALANCE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Account Information
 */
export interface AccountInfo {
    starkKey: string;
    positionId: string;
    vault: string;
    tradingEnabled: boolean;
}

/**
 * Balance
 */
export interface Balance {
    equity: string;
    freeCollateral: string;
    pendingDeposits: string;
    pendingWithdrawals: string;
    totalPositionValue: string;
    unrealizedPnl: string;
    realizedPnl: string;
    marginRatio: string;
    availableForTrade: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Position
 */
export interface Position {
    market: string;
    side: 'LONG' | 'SHORT';
    size: string;
    entryPrice: string;
    markPrice: string;
    liquidationPrice: string;
    unrealizedPnl: string;
    realizedPnl: string;
    leverage: string;
    margin: string;
    maintenanceMargin: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDER TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Order Side
 */
export enum OrderSide {
    BUY = 'BUY',
    SELL = 'SELL',
}

/**
 * Order Type
 */
export enum OrderType {
    LIMIT = 'LIMIT',
    CONDITIONAL = 'CONDITIONAL',
    TPSL = 'TPSL',
    TWAP = 'TWAP',
}

/**
 * Time In Force
 */
export enum TimeInForce {
    GTC = 'GTC', // Good Till Cancel
    GTT = 'GTT', // Good Till Time
    IOC = 'IOC', // Immediate Or Cancel
    FOK = 'FOK', // Fill Or Kill
}

/**
 * Order Status
 */
export enum OrderStatus {
    PENDING = 'PENDING',
    OPEN = 'OPEN',
    FILLED = 'FILLED',
    PARTIALLY_FILLED = 'PARTIALLY_FILLED',
    CANCELLED = 'CANCELLED',
    REJECTED = 'REJECTED',
    EXPIRED = 'EXPIRED',
}

/**
 * Order
 */
export interface Order {
    id: number;
    externalId?: string;
    market: string;
    side: OrderSide;
    type: OrderType;
    price: string;
    size: string;
    filledSize: string;
    remainingSize: string;
    avgFillPrice: string;
    timeInForce: TimeInForce;
    status: OrderStatus;
    statusReason?: string;
    reduceOnly: boolean;
    postOnly: boolean;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
}

/**
 * Create Order Request
 */
export interface CreateOrderRequest {
    market: string;
    side: OrderSide;
    type: OrderType;
    size: string;
    price?: string;
    triggerPrice?: string;
    triggerPriceType?: 'LAST' | 'MARK' | 'INDEX';
    triggerDirection?: 'UP' | 'DOWN';
    executionPriceType?: 'LIMIT' | 'MARKET';
    timeInForce: TimeInForce;
    expiryEpochMillis?: number;
    reduceOnly?: boolean;
    postOnly?: boolean;
    externalId?: string;
    selfTradeProtection?: 'ACCOUNT' | 'ORDER';
    tpslType?: 'ORDER' | 'POSITION';
    takeProfit?: {
        triggerPrice: string;
        triggerPriceType: 'LAST' | 'MARK' | 'INDEX';
        price?: string;
        priceType?: 'LIMIT' | 'MARKET';
    };
    stopLoss?: {
        triggerPrice: string;
        triggerPriceType: 'LAST' | 'MARK' | 'INDEX';
        price?: string;
        priceType?: 'LIMIT' | 'MARKET';
    };
}

/**
 * Order Response
 */
export interface OrderResponse {
    order: Order;
}

// ═══════════════════════════════════════════════════════════════════════════
// USER TRADE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * User Trade
 */
export interface UserTrade {
    id: number;
    orderId: number;
    market: string;
    side: OrderSide;
    price: string;
    qty: string;
    quoteQty: string;
    fee: string;
    feeAsset: string;
    isMaker: boolean;
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVERAGE & FEE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Leverage Information
 */
export interface LeverageInfo {
    market: string;
    leverage: string;
    maxLeverage: string;
}

/**
 * Fee Information
 */
export interface FeeInfo {
    market: string;
    makerFee: string;
    takerFee: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MASS CANCEL TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mass Cancel Parameters
 */
export interface MassCancelParams {
    market?: string;
    side?: OrderSide;
    type?: OrderType;
    cancelAll?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WebSocket Subscription Message
 */
export interface WsSubscribeMessage {
    type: 'subscribe' | 'unsubscribe';
    channel: string;
    market?: string;
    interval?: string;
}

/**
 * Order Book Update
 */
export interface OrderBookUpdate {
    market: string;
    timestamp: number;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
}

/**
 * Trade Update
 */
export interface TradeUpdate {
    id: number;
    market: string;
    price: string;
    size: string;
    side: OrderSide;
    timestamp: number;
}

/**
 * Funding Rate Update
 */
export interface FundingRateUpdate {
    market: string;
    rate: string;
    nextFundingTime: number;
    timestamp: number;
}

/**
 * Candle Update
 */
export interface CandleUpdate {
    market: string;
    interval: string;
    timestamp: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
}

/**
 * Price Update
 */
export interface PriceUpdate {
    market: string;
    price: string;
    timestamp: number;
}

/**
 * Account Update
 */
export interface AccountUpdate {
    type: 'ORDER' | 'POSITION' | 'BALANCE' | 'TRADE';
    data: Order | Position | Balance | UserTrade;
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY QUERY PARAMS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Order History Parameters
 */
export interface OrderHistoryParams {
    market?: string;
    type?: OrderType;
    side?: OrderSide;
    status?: OrderStatus;
    startTime?: number;
    endTime?: number;
    page?: number;
    pageSize?: number;
}

/**
 * Trade History Parameters
 */
export interface TradeHistoryParams {
    market?: string;
    orderId?: number;
    startTime?: number;
    endTime?: number;
    page?: number;
    pageSize?: number;
}
