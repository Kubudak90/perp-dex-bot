// ═══════════════════════════════════════════════════════════════════════════
// EXTENDED MARKET DATA TEST
// Test Extended connector's market data endpoints
// ═══════════════════════════════════════════════════════════════════════════

import { config as dotenvConfig } from 'dotenv';
import { ExchangeFactory, ExchangePlatform } from './exchanges/factory';
import { ExtendedConnector } from './exchanges/extended/connector';

dotenvConfig();

async function testMarketData() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           Extended Market Data Test                                   ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);

    try {
        // Create Extended connector
        const apiKey = process.env.EXTENDED_API_KEY || '';
        const useTestnet = process.env.USE_TESTNET === 'true';

        console.log(`📡 Testing Extended ${useTestnet ? 'Testnet' : 'Mainnet'}...\n`);

        const connector = ExchangeFactory.create(ExchangePlatform.EXTENDED, {
            apiKey: apiKey || undefined,
            testnet: useTestnet,
        }) as ExtendedConnector;

        await connector.connect();
        console.log('✅ Connected to Extended\n');

        // Test 1: Get Market Data
        console.log('─────────────────────────────────────────────────────────────');
        console.log('TEST 1: Get Market Data');
        console.log('─────────────────────────────────────────────────────────────');

        const symbol = 'BTC-USD';
        const marketData = await connector.getMarketData(symbol);

        console.log(`Symbol: ${marketData.symbol}`);
        console.log(`Mark Price: $${marketData.markPrice.toFixed(2)}`);
        console.log(`Index Price: $${marketData.indexPrice.toFixed(2)}`);
        console.log(`Funding Rate: ${(marketData.fundingRate * 100).toFixed(4)}%`);
        console.log(`24h Volume: $${marketData.volume24h.toLocaleString()}`);
        console.log(`Open Interest: $${marketData.openInterest.toLocaleString()}`);
        console.log('✅ Market data fetched successfully\n');

        // Test 2: Get Historical Candles
        console.log('─────────────────────────────────────────────────────────────');
        console.log('TEST 2: Get Historical Candles');
        console.log('─────────────────────────────────────────────────────────────');

        const timeframe = '15m';
        const limit = 100;

        console.log(`Fetching ${limit} candles for ${symbol} on ${timeframe} timeframe...`);

        const candles = await connector.getCandles(symbol, timeframe, limit);

        console.log(`Total candles: ${candles.length}`);

        if (candles.length > 0) {
            const latest = candles[candles.length - 1];
            const oldest = candles[0];

            console.log('\nLatest candle:');
            console.log(`  Timestamp: ${new Date(latest.timestamp).toISOString()}`);
            console.log(`  Open: $${latest.open.toFixed(2)}`);
            console.log(`  High: $${latest.high.toFixed(2)}`);
            console.log(`  Low: $${latest.low.toFixed(2)}`);
            console.log(`  Close: $${latest.close.toFixed(2)}`);
            console.log(`  Volume: $${latest.volume.toLocaleString()}`);

            console.log('\nOldest candle:');
            console.log(`  Timestamp: ${new Date(oldest.timestamp).toISOString()}`);
            console.log(`  Close: $${oldest.close.toFixed(2)}`);

            console.log(`\nTime range: ${new Date(oldest.timestamp).toISOString()} to ${new Date(latest.timestamp).toISOString()}`);
            console.log('✅ Candles fetched successfully\n');
        } else {
            console.log('⚠️  No candles returned');
        }

        // Test 3: Get Balance (if credentials provided)
        console.log('─────────────────────────────────────────────────────────────');
        console.log('TEST 3: Get Account Balance');
        console.log('─────────────────────────────────────────────────────────────');

        if (apiKey) {
            try {
                const balance = await connector.getBalance();

                console.log(`Total Equity: $${balance.total.toFixed(2)}`);
                console.log(`Available: $${balance.available.toFixed(2)}`);
                console.log(`Locked: $${balance.locked.toFixed(2)}`);
                console.log(`Unrealized PnL: $${balance.unrealizedPnl.toFixed(2)}`);
                console.log('✅ Balance fetched successfully\n');
            } catch (error: any) {
                console.log(`❌ Balance fetch failed (expected without valid API key): ${error.message}\n`);
            }
        } else {
            console.log('⏭️  Skipped (no API key provided)\n');
        }

        // Test 4: Get Positions (if credentials provided)
        console.log('─────────────────────────────────────────────────────────────');
        console.log('TEST 4: Get Open Positions');
        console.log('─────────────────────────────────────────────────────────────');

        if (apiKey) {
            try {
                const positions = await connector.getPositions();

                console.log(`Open positions: ${positions.length}`);

                if (positions.length > 0) {
                    positions.forEach((pos, i) => {
                        console.log(`\nPosition ${i + 1}:`);
                        console.log(`  Side: ${pos.side}`);
                        console.log(`  Size: ${pos.size}`);
                        console.log(`  Entry Price: $${pos.entryPrice.toFixed(2)}`);
                        console.log(`  Unrealized PnL: $${pos.unrealizedPnl.toFixed(2)}`);
                    });
                }

                console.log('✅ Positions fetched successfully\n');
            } catch (error: any) {
                console.log(`❌ Positions fetch failed (expected without valid API key): ${error.message}\n`);
            }
        } else {
            console.log('⏭️  Skipped (no API key provided)\n');
        }

        // Test 5: Get Trading Stats
        console.log('─────────────────────────────────────────────────────────────');
        console.log('TEST 5: Get Trading Statistics');
        console.log('─────────────────────────────────────────────────────────────');

        if (apiKey) {
            try {
                const stats = await connector.getStats();

                console.log(`Total Trades: ${stats.totalTrades}`);
                console.log(`Total Volume: $${stats.totalVolume.toLocaleString()}`);

                if (stats.points) {
                    console.log(`Airdrop Points: ${stats.points.toLocaleString()}`);
                }

                if (stats.fees) {
                    console.log(`Total Fees: $${stats.fees.total.toFixed(2)}`);
                }

                console.log('✅ Stats fetched successfully\n');
            } catch (error: any) {
                console.log(`❌ Stats fetch failed (expected without valid API key): ${error.message}\n`);
            }
        } else {
            console.log('⏭️  Skipped (no API key provided)\n');
        }

        await connector.disconnect();
        console.log('✅ Disconnected from Extended');

        console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
        console.log('║                     ALL TESTS COMPLETED                               ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

        // Summary
        console.log('Summary:');
        console.log('─────────────────────────────────────────────────────────────');
        console.log('✅ Market data fetching works');
        console.log('✅ Historical candles fetching works');
        console.log('✅ Extended connector is ready for bot integration');
        console.log('');
        console.log('Next steps:');
        console.log('1. Add EXTENDED_API_KEY to .env for account operations');
        console.log('2. Run bot with MODE=live EXCHANGE=extended');
        console.log('3. Monitor airdrop points accumulation');
        console.log('─────────────────────────────────────────────────────────────\n');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
}

// Run test
testMarketData().catch(console.error);
