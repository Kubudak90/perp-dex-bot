// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE FACTORY
// Creates exchange connectors based on platform
// ═══════════════════════════════════════════════════════════════════════════

import { ExchangeConfig } from './interface';
import { ExtendedConnector } from './extended/connector';

/**
 * Supported exchange platforms
 */
export enum ExchangePlatform {
    EXTENDED = 'extended',
    GRVT = 'grvt',
    PACIFICA = 'pacifica',
    HYPERLIQUID = 'hyperliquid',
}

/**
 * Exchange Factory
 * Creates appropriate connector based on platform
 */
export class ExchangeFactory {
    /**
     * Create exchange connector
     * @param platform Exchange platform
     * @param config Exchange configuration
     * @returns Exchange connector instance
     */
    static create(platform: ExchangePlatform, config: ExchangeConfig): any {
        switch (platform) {
            case ExchangePlatform.EXTENDED:
                return new ExtendedConnector(config);

            case ExchangePlatform.GRVT:
                throw new Error('GRVT connector not yet implemented');

            case ExchangePlatform.PACIFICA:
                throw new Error('Pacifica connector not yet implemented');

            case ExchangePlatform.HYPERLIQUID:
                throw new Error('Use HyperliquidConnector directly from utils/exchange');

            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }
}
