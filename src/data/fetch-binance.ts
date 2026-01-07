// ═══════════════════════════════════════════════════════════════════════════
// BINANCE DATA FETCHER
// Fetch real historical data from Binance public API
// ═══════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { writeFileSync } from 'fs';
import { Candle } from '../types';

const BINANCE_API = 'https://api.binance.com/api/v3';

interface BinanceKline {
    openTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    closeTime: number;
}

async function fetchBinanceData(
    symbol: string = 'BTCUSDT',
    interval: string = '15m',
    days: number = 90
): Promise<Candle[]> {
    console.log(`\n📊 Fetching ${symbol} ${interval} data for last ${days} days from Binance...`);

    const endTime = Date.now();
    const startTime = endTime - (days * 24 * 60 * 60 * 1000);

    const candles: Candle[] = [];
    let currentStart = startTime;

    // Binance has a 1000 candle limit per request
    const limit = 1000;

    while (currentStart < endTime) {
        try {
            const response = await axios.get(`${BINANCE_API}/klines`, {
                params: {
                    symbol,
                    interval,
                    startTime: currentStart,
                    endTime,
                    limit,
                },
            });

            const klines: BinanceKline[] = response.data;

            if (klines.length === 0) break;

            for (const kline of klines) {
                candles.push({
                    timestamp: kline.openTime,
                    open: parseFloat(kline.open),
                    high: parseFloat(kline.high),
                    low: parseFloat(kline.low),
                    close: parseFloat(kline.close),
                    volume: parseFloat(kline.volume),
                });
            }

            // Move to next batch
            currentStart = klines[klines.length - 1].closeTime + 1;

            console.log(`  Fetched ${klines.length} candles (total: ${candles.length})`);

            // Rate limiting
            await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error: any) {
            console.error('❌ Error fetching data:', error.message);
            throw error;
        }
    }

    console.log(`✅ Total candles fetched: ${candles.length}`);

    // Sort by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);

    return candles;
}

async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                   BINANCE DATA FETCHER                                ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);

    try {
        // Fetch last 30, 60, 90 days
        const periods = [30, 60, 90];

        for (const days of periods) {
            console.log(`\n${'='.repeat(70)}`);
            const candles = await fetchBinanceData('BTCUSDT', '15m', days);

            const filename = `src/data/binance-btc-15m-${days}d.json`;
            writeFileSync(filename, JSON.stringify(candles, null, 2));

            console.log(`💾 Saved to: ${filename}`);

            // Stats
            const firstDate = new Date(candles[0].timestamp).toISOString();
            const lastDate = new Date(candles[candles.length - 1].timestamp).toISOString();
            const firstPrice = candles[0].close;
            const lastPrice = candles[candles.length - 1].close;
            const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;

            console.log(`\nPeriod Stats (${days} days):`);
            console.log(`  Date Range: ${firstDate} → ${lastDate}`);
            console.log(`  Price: $${firstPrice.toFixed(2)} → $${lastPrice.toFixed(2)}`);
            console.log(`  Change: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%`);
            console.log(`  Total Candles: ${candles.length}`);
        }

        console.log(`\n${'='.repeat(70)}`);
        console.log('\n✅ All data fetched successfully!\n');
        console.log('Next steps:');
        console.log('  1. Run backtest on 30d: npm run backtest:30d');
        console.log('  2. Run backtest on 60d: npm run backtest:60d');
        console.log('  3. Run backtest on 90d: npm run backtest:90d\n');
    } catch (error) {
        console.error('\n❌ Failed to fetch data:', error);
        process.exit(1);
    }
}

main();
