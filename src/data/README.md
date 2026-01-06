# Binance Historical Data

This directory contains historical market data for backtesting.

## Fetching Binance Data

The automated fetcher (`fetch-binance.ts`) may not work in restricted environments. Here are alternative methods:

### Method 1: Use curl (Manual)

Fetch last 30 days of BTCUSDT 15m data:

```bash
# Calculate timestamps (30 days ago to now)
END_TIME=$(date +%s)000
START_TIME=$((END_TIME - 30*24*60*60*1000))

# Fetch from Binance API
curl -X GET "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime=$START_TIME&endTime=$END_TIME&limit=1000" \
  -H "Accept: application/json" > binance-raw-30d.json
```

### Method 2: Use Python Script

Create `fetch_binance.py`:

```python
import requests
import json
from datetime import datetime, timedelta

def fetch_binance_data(symbol='BTCUSDT', interval='15m', days=30):
    """Fetch historical klines from Binance"""

    end_time = int(datetime.now().timestamp() * 1000)
    start_time = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)

    url = 'https://api.binance.com/api/v3/klines'
    params = {
        'symbol': symbol,
        'interval': interval,
        'startTime': start_time,
        'endTime': end_time,
        'limit': 1000
    }

    all_candles = []

    while start_time < end_time:
        params['startTime'] = start_time
        response = requests.get(url, params=params)
        data = response.json()

        if not data:
            break

        # Convert to our format
        for kline in data:
            candle = {
                'timestamp': kline[0],
                'open': float(kline[1]),
                'high': float(kline[2]),
                'low': float(kline[3]),
                'close': float(kline[4]),
                'volume': float(kline[5])
            }
            all_candles.append(candle)

        # Move to next batch
        start_time = data[-1][6] + 1  # closeTime + 1

        print(f"Fetched {len(data)} candles, total: {len(all_candles)}")

    return all_candles

# Fetch data for 30, 60, 90 days
for days in [30, 60, 90]:
    print(f"\nFetching {days}-day data...")
    candles = fetch_binance_data('BTCUSDT', '15m', days)

    filename = f'binance-btc-15m-{days}d.json'
    with open(filename, 'w') as f:
        json.dump(candles, f, indent=2)

    print(f"Saved {len(candles)} candles to {filename}")
```

Run with:
```bash
pip install requests
python fetch_binance.py
```

### Method 3: Use Existing Tools

- **ccxt library**: Popular crypto exchange library
- **TradingView**: Export historical data
- **CryptoCompare API**: Alternative data source

## Data Format

The backtest expects JSON files with this structure:

```json
[
  {
    "timestamp": 1704067200000,
    "open": 42156.50,
    "high": 42280.00,
    "low": 42100.00,
    "close": 42250.75,
    "volume": 125.5
  },
  ...
]
```

## Required Files

For running backtests, you need:
- `binance-btc-15m-30d.json` - Last 30 days
- `binance-btc-15m-60d.json` - Last 60 days
- `binance-btc-15m-90d.json` - Last 90 days

## Running Backtests

Once data files are in place:

```bash
# Test on 30-day data
npm run backtest:30d

# Test on 60-day data
npm run backtest:60d

# Test on 90-day data
npm run backtest:90d
```

## Notes

- Binance API has rate limits (1200 requests/minute)
- Each request returns max 1000 candles
- 15m interval: 1000 candles = ~10.4 days
- You'll need 3-9 requests to fetch 30-90 days

## Troubleshooting

**403 Forbidden**: Some environments block Binance API. Use alternative methods above.

**Empty Data**: Check your timestamps are in milliseconds (not seconds).

**Missing Candles**: Binance may have gaps during maintenance. This is normal.
