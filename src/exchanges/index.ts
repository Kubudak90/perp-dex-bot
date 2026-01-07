// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGES - Main Export
// Factory for creating exchange connectors
// ═══════════════════════════════════════════════════════════════════════════

// Export from interface
export * from './interface';

// Export Extended connector (not all types to avoid conflicts)
export { ExtendedConnector, ExtendedRestClient, ExtendedWebSocketClient } from './extended';

import { IExchange, ExchangeConfig } from './interface';
import { ExtendedConnector } from './extended';

/**
 * Supported exchange platforms
 */
export enum ExchangePlatform {
    EXTENDED = 'extended',
    GRVT = 'grvt',
    PACIFICA = 'pacifica',
}

/**
 * Exchange Factory
 * Creates appropriate connector based on platform
 */
export class ExchangeFactory {
    static create(platform: ExchangePlatform, config: ExchangeConfig): IExchange {
        switch (platform) {
            case ExchangePlatform.EXTENDED:
                return new ExtendedConnector(config);

            case ExchangePlatform.GRVT:
                throw new Error('GRVT connector not yet implemented');

            case ExchangePlatform.PACIFICA:
                throw new Error('Pacifica connector not yet implemented');

            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }
}
