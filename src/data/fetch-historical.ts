// ═══════════════════════════════════════════════════════════════════════════
// HISTORICAL DATA FETCHER
// Fetch real historical candle data for backtesting
// ═══════════════════════════════════════════════════════════════════════════

import { Candle } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────
// BINANCE FUTURES API (Public, No Auth Required)
// Most liquid BTC-PERP market, good proxy for Extended/other DEXs
// ─────────────────────────────────────────────────────────────────────────
export class HistoricalDataFetcher {
    private baseUrl = 'https://fapi.binance.com';

    /**
     * Fetch historical klines from Binance Futures
     * @param symbol - e.g., 'BTCUSDT'
     * @param interval - e.g., '15m', '1h', '4h'
     * @param startTime - Unix timestamp in ms
     * @param endTime - Unix timestamp in ms
     * @param limit - Max 1500 per request
     */
    async fetchBinanceKlines(
        symbol: string = 'BTCUSDT',
        interval: string = '15m',
        startTime: number,
        endTime: number,
        limit: number = 1500
    ): Promise<Candle[]> {
        const url = `${this.baseUrl}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

        console.log(`Fetching ${symbol} ${interval} candles from Binance Futures...`);
        console.log(`  Start: ${new Date(startTime).toISOString()}`);
        console.log(`  End:   ${new Date(endTime).toISOString()}`);

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            const candles: Candle[] = data.map((k: any[]) => ({
                timestamp: k[0],                    // Open time
                open: parseFloat(k[1]),             // Open price
                high: parseFloat(k[2]),             // High price
                low: parseFloat(k[3]),              // Low price
                close: parseFloat(k[4]),            // Close price
                volume: parseFloat(k[5])            // Volume
            }));

            console.log(`✅ Fetched ${candles.length} candles`);
            return candles;

        } catch (error) {
            console.error('❌ Failed to fetch data:', error);
            return [];
        }
    }

    /**
     * Fetch multiple batches to get more than 1500 candles
     * Binance limits to 1500 per request, so we need to batch
     */
    async fetchHistoricalData(
        symbol: string = 'BTCUSDT',
        interval: string = '15m',
        days: number = 90
    ): Promise<Candle[]> {
        const intervalMs = this.getIntervalMs(interval);
        const endTime = Date.now();
        const startTime = endTime - (days * 24 * 60 * 60 * 1000);

        const allCandles: Candle[] = [];
        const batchSize = 1500;
        const batchDuration = batchSize * intervalMs;

        let currentStart = startTime;

        while (currentStart < endTime) {
            const currentEnd = Math.min(currentStart + batchDuration, endTime);

            const candles = await this.fetchBinanceKlines(
                symbol,
                interval,
                currentStart,
                currentEnd,
                batchSize
            );

            allCandles.push(...candles);

            // Rate limiting: Wait 100ms between requests
            await this.sleep(100);

            currentStart = currentEnd;
        }

        console.log(`\n📊 Total candles fetched: ${allCandles.length}`);
        console.log(`   Period: ${new Date(allCandles[0]?.timestamp || 0).toISOString()} to ${new Date(allCandles[allCandles.length - 1]?.timestamp || 0).toISOString()}`);

        return allCandles;
    }

    /**
     * Save candles to JSON file for caching
     */
    async saveToFile(candles: Candle[], filename: string): Promise<void> {
        const dataDir = path.join(__dirname, '../../data');

        // Create data directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const filepath = path.join(dataDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(candles, null, 2));

        console.log(`💾 Saved ${candles.length} candles to ${filepath}`);
    }

    /**
     * Load candles from JSON file
     */
    async loadFromFile(filename: string): Promise<Candle[] | null> {
        const filepath = path.join(__dirname, '../../data', filename);

        if (!fs.existsSync(filepath)) {
            return null;
        }

        const data = fs.readFileSync(filepath, 'utf-8');
        const candles = JSON.parse(data);

        console.log(`📁 Loaded ${candles.length} candles from ${filepath}`);

        return candles;
    }

    /**
     * Get interval in milliseconds
     */
    private getIntervalMs(interval: string): number {
        const map: Record<string, number> = {
            '1m': 60000,
            '3m': 180000,
            '5m': 300000,
            '15m': 900000,
            '30m': 1800000,
            '1h': 3600000,
            '2h': 7200000,
            '4h': 14400000,
            '6h': 21600000,
            '8h': 28800000,
            '12h': 43200000,
            '1d': 86400000,
            '3d': 259200000,
            '1w': 604800000,
        };

        return map[interval] || 900000; // Default 15m
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ─────────────────────────────────────────────────────────────────────────
// CLI USAGE
// ─────────────────────────────────────────────────────────────────────────
async function main() {
    const fetcher = new HistoricalDataFetcher();

    const symbol = process.env.SYMBOL || 'BTCUSDT';
    const interval = process.env.INTERVAL || '15m';
    const days = parseInt(process.env.DAYS || '90');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  HISTORICAL DATA FETCHER');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`  Symbol:   ${symbol}`);
    console.log(`  Interval: ${interval}`);
    console.log(`  Days:     ${days}`);
    console.log('');

    // Check if cached data exists
    const filename = `${symbol}_${interval}_${days}d.json`;
    let candles = await fetcher.loadFromFile(filename);

    if (candles && candles.length > 0) {
        console.log('✅ Using cached data\n');
    } else {
        console.log('📡 Fetching from Binance Futures API...\n');
        candles = await fetcher.fetchHistoricalData(symbol, interval, days);

        if (candles.length > 0) {
            await fetcher.saveToFile(candles, filename);
        }
    }

    // Print sample
    if (candles && candles.length > 0) {
        console.log('\n📊 Sample data (first 5 candles):');
        console.log('─'.repeat(80));
        candles.slice(0, 5).forEach(c => {
            console.log(
                `${new Date(c.timestamp).toISOString()} | ` +
                `O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} | ` +
                `Vol:${c.volume.toFixed(2)}`
            );
        });
        console.log('─'.repeat(80));
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
