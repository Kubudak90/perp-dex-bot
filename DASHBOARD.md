# Dashboard Setup and Usage

This guide explains how to set up and run the real-time dashboard for the Perp DEX Bot.

## Architecture

The dashboard consists of two components:

1. **API Server** (`src/api/server.ts`) - Express server with REST API and WebSocket support
2. **Next.js Dashboard** (`dashboard/`) - React-based web interface

```
┌─────────────────┐     WebSocket      ┌─────────────────┐     Extended API     ┌──────────────┐
│   Next.js       │ ←─────────────────→ │   API Server    │ ←──────────────────→ │   Extended   │
│   Dashboard     │     (ws://3000/ws)  │   (port 3000)   │                      │   Exchange   │
│   (port 3001)   │                     │                 │                      │              │
└─────────────────┘                     └─────────────────┘                      └──────────────┘
```

## Features

- **Real-time Updates**: WebSocket broadcasts every 5 seconds
- **Connection Status**: Visual indicator with auto-reconnect
- **Account Overview**: Total equity, available balance, margin used
- **Open Positions**: Live position tracking with unrealized PnL
- **Trading Stats**: Total trades, win rate, volume, airdrop points
- **Bot Status**: Strategy settings and exchange info

## Installation

### 1. Install Dependencies

```bash
# Install main project dependencies
npm install

# Install dashboard dependencies
cd dashboard
npm install
cd ..
```

### 2. Configure Environment

Create `.env` file in the root directory:

```bash
# Extended Exchange Configuration
EXTENDED_API_KEY=your_api_key_here
EXTENDED_VAULT=your_vault_id_here
STARKNET_PRIVATE_KEY=your_private_key_here
USE_TESTNET=true

# Optional: Python path (defaults to python3)
PYTHON_PATH=python3

# API Server Port (optional, defaults to 3000)
API_PORT=3000
```

The dashboard is pre-configured to connect to `ws://localhost:3000/ws`.

## Running the Dashboard

### Option 1: Run API Server Only

```bash
npm run api
```

This starts the API server on port 3000 with:
- REST endpoints: `http://localhost:3000/api/*`
- WebSocket: `ws://localhost:3000/ws`

Then in another terminal, run the dashboard:

```bash
npm run dashboard
```

Dashboard will be available at `http://localhost:3001`

### Option 2: Development Mode

```bash
# Terminal 1: API Server
npm run api

# Terminal 2: Dashboard
npm run dashboard
```

## API Endpoints

### REST API

- **GET /api/health** - Server health check
  ```json
  {
    "status": "ok",
    "connected": true,
    "timestamp": 1234567890
  }
  ```

- **GET /api/balance** - Get account balance
  ```json
  {
    "success": true,
    "data": {
      "total": 12450.50,
      "available": 10000.00,
      "margin": 2450.50
    }
  }
  ```

- **GET /api/positions** - Get open positions
  ```json
  {
    "success": true,
    "data": [
      {
        "symbol": "BTC-USD",
        "side": "LONG",
        "size": 0.05,
        "entryPrice": 62000,
        "markPrice": 62450,
        "unrealizedPnl": 22.50,
        "realizedPnl": 0,
        "leverage": 5,
        "liquidationPrice": 58000
      }
    ]
  }
  ```

- **GET /api/stats** - Get trading statistics
  ```json
  {
    "success": true,
    "data": {
      "totalTrades": 156,
      "winningTrades": 107,
      "losingTrades": 49,
      "winRate": 68.5,
      "totalPnl": 324.20,
      "totalVolume": 1245000,
      "averageWin": 15.5,
      "averageLoss": -8.2,
      "largestWin": 125.0,
      "largestLoss": -45.0
    }
  }
  ```

- **GET /api/market/:symbol** - Get market data for a symbol
  ```json
  {
    "success": true,
    "data": {
      "symbol": "BTC-USD",
      "price": 62450,
      "24hChange": 2.5,
      "24hVolume": 1500000,
      "fundingRate": 0.0001
    }
  }
  ```

### WebSocket

Connect to `ws://localhost:3000/ws`

**Initial State Message**:
```json
{
  "type": "init",
  "timestamp": 1234567890,
  "data": {
    "balance": { ... },
    "positions": [ ... ],
    "stats": { ... },
    "connected": true
  }
}
```

**Update Messages** (every 5 seconds):
```json
{
  "type": "update",
  "timestamp": 1234567890,
  "data": {
    "balance": { ... },
    "positions": [ ... ],
    "stats": { ... }
  }
}
```

## Dashboard Features

### Connection Status

The header shows real-time connection status:
- 🟢 **Connected** - WebSocket connected and receiving updates
- 🔴 **Disconnected** - Connection lost (click to reconnect)

### Stats Overview

Four key metrics at the top:
1. **Total Equity** - Available + Margin + Unrealized PnL
2. **Total Trades** - Trade count with win rate
3. **Trading Volume** - Total volume with estimated airdrop points
4. **Active Bots** - Number of running bots

### Open Positions

Real-time position tracking showing:
- Symbol and side (LONG/SHORT)
- Position size and entry price
- Current unrealized PnL ($ and %)
- Auto-updates every 5 seconds

### Account Summary

Balance breakdown:
- **Available Balance** - Free capital for trading
- **Margin Used** - Locked in open positions
- **Total Equity** - Complete account value

### Bot Status

Current configuration:
- **Strategy** - Supertrend + EMA parameters
- **Risk Management** - Position sizing and stop loss
- **Exchange** - Platform and fee structure

## Troubleshooting

### WebSocket Connection Failed

1. Ensure API server is running: `npm run api`
2. Check port 3000 is not in use
3. Verify `.env` configuration
4. Check browser console for errors

### Extended Connector Not Initialized

1. Verify Extended credentials in `.env`:
   - `EXTENDED_API_KEY`
   - `EXTENDED_VAULT`
   - `STARKNET_PRIVATE_KEY`
2. Check API server logs for initialization errors
3. Ensure Extended testnet/mainnet is accessible

### Dashboard Not Loading

1. Install dashboard dependencies: `cd dashboard && npm install`
2. Check Next.js is running: `npm run dashboard`
3. Navigate to `http://localhost:3001`
4. Check console for build errors

### Python SDK Errors

If order signing fails:
1. Install Python dependencies: `npm run setup:python`
2. Verify Python 3 is installed: `python3 --version`
3. Check `PYTHON_PATH` in `.env`

## Development

### Modify WebSocket Update Interval

Edit `src/api/server.ts`:

```typescript
function startBroadcasting() {
    setInterval(async () => {
        // ... broadcast logic
    }, 5000); // Change from 5000ms (5s) to desired interval
}
```

### Add New Dashboard Components

Dashboard uses shadcn/ui components. Install new components:

```bash
cd dashboard
npx shadcn-ui@latest add [component-name]
```

### Customize Theme

Edit `dashboard/app/globals.css` to change colors:

```css
:root {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... other color variables */
}
```

## Production Deployment

### Build for Production

```bash
# Build API server
npm run build

# Build dashboard
cd dashboard
npm run build
cd ..
```

### Run Production Build

```bash
# Start API server
npm start

# Start dashboard (in another terminal)
cd dashboard
npm start
```

### Environment Variables for Production

```bash
# Mainnet configuration
USE_TESTNET=false
EXTENDED_API_KEY=your_mainnet_api_key
EXTENDED_VAULT=your_mainnet_vault_id
STARKNET_PRIVATE_KEY=your_mainnet_private_key

# Production API port
API_PORT=3000
```

## Security Notes

- Never commit `.env` files to version control
- Use environment-specific API keys (testnet for dev, mainnet for prod)
- API server has CORS enabled - restrict in production
- WebSocket has no authentication - add auth for production use
- Private keys are sensitive - use secure key management

## Next Steps

1. **Add Authentication** - Protect WebSocket and REST endpoints
2. **Trade History** - Store and display historical trades
3. **Charts** - Add TradingView charts for price data
4. **Multi-Exchange** - Support GRVT and Pacifica connectors
5. **Mobile UI** - Responsive design improvements
6. **Alerts** - Push notifications for important events
7. **Strategy Controls** - Start/stop bots from dashboard
8. **Backtesting UI** - Run backtests from web interface
