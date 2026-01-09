// ═══════════════════════════════════════════════════════════════════════════
// HYPERLIQUID SDK WRAPPER
// Order signing, execution, and WebSocket integration
// ═══════════════════════════════════════════════════════════════════════════

import { ethers } from 'ethers';
import { Logger } from './logger';
import { OrderRejectedError, ExchangeError } from './errors';
import { retryWithBackoff, withTimeout } from './retry';

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────
export interface OrderRequest {
    asset: string;
    isBuy: boolean;
    limitPx: number;
    sz: number;
    reduceOnly: boolean;
    orderType: {
        limit?: { tif: 'Gtc' | 'Ioc' | 'Alo' };
        trigger?: { triggerPx: number; isMarket: boolean; tpsl: 'tp' | 'sl' };
    };
}

export interface OrderResponse {
    status: 'ok' | 'err';
    response: {
        type: 'order' | 'cancel' | 'error';
        data?: {
            statuses: Array<{
                resting?: { oid: number };
                filled?: { totalSz: string; avgPx: string; oid: number };
                error?: string;
            }>;
        };
    };
}

export interface SlippageConfig {
    maxSlippageBps: number; // Basis points (100 = 1%)
    priceImpactThreshold: number; // Max acceptable price impact %
}

// ─────────────────────────────────────────────────────────────────────────
// HYPERLIQUID ORDER MANAGER
// ─────────────────────────────────────────────────────────────────────────
export class HyperliquidOrderManager {
    private logger: Logger;
    private wallet: ethers.Wallet;
    private apiUrl: string;
    private readonly TIMEOUT = 30000;

    constructor(privateKey: string, testnet: boolean = true) {
        this.logger = new Logger('HLOrderManager');
        this.wallet = new ethers.Wallet(privateKey);
        this.apiUrl = testnet
            ? 'https://api.hyperliquid-testnet.xyz'
            : 'https://api.hyperliquid.xyz';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PLACE ORDER (with slippage protection)
    // ─────────────────────────────────────────────────────────────────────────
    async placeOrder(
        order: OrderRequest,
        slippageConfig: SlippageConfig
    ): Promise<{ orderId: number; avgPrice: number; filledSize: number }> {
        return await retryWithBackoff(
            async () => {
                // Get current mark price for slippage check
                const markPrice = await this.getMarkPrice(order.asset);

                // Calculate acceptable price range
                const maxSlippage = (slippageConfig.maxSlippageBps / 10000) * markPrice;
                const acceptablePrice = order.isBuy
                    ? markPrice + maxSlippage
                    : markPrice - maxSlippage;

                // Adjust limit price to prevent excessive slippage
                if (order.isBuy && order.limitPx > acceptablePrice) {
                    this.logger.warn(
                        `Adjusting buy limit price from ${order.limitPx} to ${acceptablePrice} (slippage protection)`
                    );
                    order.limitPx = acceptablePrice;
                } else if (!order.isBuy && order.limitPx < acceptablePrice) {
                    this.logger.warn(
                        `Adjusting sell limit price from ${order.limitPx} to ${acceptablePrice} (slippage protection)`
                    );
                    order.limitPx = acceptablePrice;
                }

                // Sign and send order
                const signature = await this.signOrder(order);
                const response = await this.sendOrder(order, signature);

                // Parse response
                if (response.status === 'err') {
                    throw new OrderRejectedError(
                        `Order rejected: ${JSON.stringify(response.response)}`
                    );
                }

                const orderStatus = response.response.data?.statuses[0];

                if (orderStatus?.error) {
                    throw new OrderRejectedError(`Order error: ${orderStatus.error}`);
                }

                if (orderStatus?.filled) {
                    return {
                        orderId: orderStatus.filled.oid,
                        avgPrice: parseFloat(orderStatus.filled.avgPx),
                        filledSize: parseFloat(orderStatus.filled.totalSz)
                    };
                }

                if (orderStatus?.resting) {
                    // Order is resting (not filled yet)
                    this.logger.info(`Order resting: ${orderStatus.resting.oid}`);
                    return {
                        orderId: orderStatus.resting.oid,
                        avgPrice: order.limitPx,
                        filledSize: 0
                    };
                }

                throw new OrderRejectedError('Unexpected order response');
            },
            { maxRetries: 2 },
            this.logger,
            'placeOrder'
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MARKET ORDER (immediate execution)
    // ─────────────────────────────────────────────────────────────────────────
    async marketOrder(
        asset: string,
        isBuy: boolean,
        size: number,
        slippageConfig: SlippageConfig
    ): Promise<{ orderId: number; avgPrice: number; filledSize: number }> {
        const markPrice = await this.getMarkPrice(asset);

        // Use IOC (Immediate or Cancel) order type
        const order: OrderRequest = {
            asset,
            isBuy,
            limitPx: isBuy
                ? markPrice * (1 + slippageConfig.maxSlippageBps / 10000)
                : markPrice * (1 - slippageConfig.maxSlippageBps / 10000),
            sz: size,
            reduceOnly: false,
            orderType: { limit: { tif: 'Ioc' } }
        };

        return await this.placeOrder(order, slippageConfig);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLOSE POSITION
    // ─────────────────────────────────────────────────────────────────────────
    async closePosition(
        asset: string,
        size: number,
        isLong: boolean,
        slippageConfig: SlippageConfig
    ): Promise<{ orderId: number; avgPrice: number }> {
        const markPrice = await this.getMarkPrice(asset);

        const order: OrderRequest = {
            asset,
            isBuy: !isLong, // Close long = sell, close short = buy
            limitPx: isLong
                ? markPrice * (1 - slippageConfig.maxSlippageBps / 10000)
                : markPrice * (1 + slippageConfig.maxSlippageBps / 10000),
            sz: size,
            reduceOnly: true,
            orderType: { limit: { tif: 'Ioc' } }
        };

        const result = await this.placeOrder(order, slippageConfig);
        return { orderId: result.orderId, avgPrice: result.avgPrice };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SET STOP LOSS / TAKE PROFIT
    // ─────────────────────────────────────────────────────────────────────────
    async setStopLoss(
        asset: string,
        triggerPrice: number,
        size: number,
        isLong: boolean
    ): Promise<number> {
        const order: OrderRequest = {
            asset,
            isBuy: !isLong,
            limitPx: triggerPrice,
            sz: size,
            reduceOnly: true,
            orderType: {
                trigger: {
                    triggerPx: triggerPrice,
                    isMarket: true,
                    tpsl: 'sl'
                }
            }
        };

        const signature = await this.signOrder(order);
        const response = await this.sendOrder(order, signature);

        if (response.status === 'err' || response.response.data?.statuses[0]?.error) {
            throw new OrderRejectedError('Failed to set stop loss');
        }

        const oid = response.response.data?.statuses[0]?.resting?.oid;
        if (!oid) throw new OrderRejectedError('No order ID returned for stop loss');

        return oid;
    }

    async setTakeProfit(
        asset: string,
        triggerPrice: number,
        size: number,
        isLong: boolean
    ): Promise<number> {
        const order: OrderRequest = {
            asset,
            isBuy: !isLong,
            limitPx: triggerPrice,
            sz: size,
            reduceOnly: true,
            orderType: {
                trigger: {
                    triggerPx: triggerPrice,
                    isMarket: true,
                    tpsl: 'tp'
                }
            }
        };

        const signature = await this.signOrder(order);
        const response = await this.sendOrder(order, signature);

        if (response.status === 'err' || response.response.data?.statuses[0]?.error) {
            throw new OrderRejectedError('Failed to set take profit');
        }

        const oid = response.response.data?.statuses[0]?.resting?.oid;
        if (!oid) throw new OrderRejectedError('No order ID returned for take profit');

        return oid;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CANCEL ORDER
    // ─────────────────────────────────────────────────────────────────────────
    async cancelOrder(asset: string, orderId: number): Promise<void> {
        const action = {
            type: 'cancel',
            cancels: [{ asset, oid: orderId }]
        };

        const signature = await this.signAction(action);

        const response = await withTimeout(
            fetch(`${this.apiUrl}/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    signature,
                    vaultAddress: null
                })
            }),
            this.TIMEOUT
        );

        if (!response.ok) {
            throw new ExchangeError(`Failed to cancel order: ${response.statusText}`);
        }

        const result = (await response.json()) as OrderResponse;

        if (result.status === 'err') {
            throw new ExchangeError(`Cancel failed: ${JSON.stringify(result.response)}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SIGN ORDER
    // ─────────────────────────────────────────────────────────────────────────
    private async signOrder(order: OrderRequest): Promise<string> {
        const action = {
            type: 'order',
            orders: [order],
            grouping: 'na'
        };

        return await this.signAction(action);
    }

    private async signAction(action: any): Promise<string> {
        // EIP-712 structured data signing for Hyperliquid
        const domain = {
            name: 'Exchange',
            version: '1',
            chainId: 1337, // Hyperliquid chain ID
            verifyingContract: '0x0000000000000000000000000000000000000000'
        };

        const types = {
            Agent: [
                { name: 'source', type: 'string' },
                { name: 'connectionId', type: 'bytes32' }
            ]
        };

        const message = {
            source: 'a',
            connectionId: ethers.randomBytes(32)
        };

        const signature = await this.wallet.signTypedData(domain, types, message);
        return signature;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEND ORDER
    // ─────────────────────────────────────────────────────────────────────────
    private async sendOrder(order: OrderRequest, signature: string): Promise<OrderResponse> {
        const response = await withTimeout(
            fetch(`${this.apiUrl}/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: {
                        type: 'order',
                        orders: [order],
                        grouping: 'na'
                    },
                    signature,
                    vaultAddress: null
                })
            }),
            this.TIMEOUT
        );

        if (!response.ok) {
            throw new ExchangeError(`Order request failed: ${response.statusText}`);
        }

        return (await response.json()) as OrderResponse;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET MARK PRICE
    // ─────────────────────────────────────────────────────────────────────────
    private async getMarkPrice(asset: string): Promise<number> {
        const response = await withTimeout(
            fetch(`${this.apiUrl}/info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'metaAndAssetCtxs' })
            }),
            this.TIMEOUT
        );

        if (!response.ok) {
            throw new ExchangeError(`Failed to fetch mark price: ${response.statusText}`);
        }

        const data = (await response.json()) as any[];
        const assetCtx = data[1]?.find((a: any) => a.coin === asset);

        if (!assetCtx) {
            throw new ExchangeError(`Asset ${asset} not found`);
        }

        return parseFloat(assetCtx.markPx);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATE SLIPPAGE
    // ─────────────────────────────────────────────────────────────────────────
    calculateSlippage(expectedPrice: number, executedPrice: number, isBuy: boolean): number {
        const slippage = isBuy
            ? ((executedPrice - expectedPrice) / expectedPrice) * 100
            : ((expectedPrice - executedPrice) / expectedPrice) * 100;

        return slippage;
    }
}
