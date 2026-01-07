# Perp DEX Bot Dashboard

Modern, dark-themed dashboard for monitoring your perpetual DEX trading bot built with Next.js 14 and shadcn/ui.

## Features

- 📊 **Real-time Stats**: Track equity, daily P&L, trade count, and win rate
- 📈 **Live Positions**: Monitor open positions with real-time P&L updates
- 💹 **Trade History**: View recent executed trades
- 🤖 **Bot Status**: Monitor strategy settings and risk management
- 🎨 **Modern UI**: Built with shadcn/ui and Tailwind CSS
- 🌙 **Dark Mode**: Easy on the eyes for long trading sessions
- ⚡ **Fast**: Next.js 14 with App Router for optimal performance

## Tech Stack

- [Next.js 14](https://nextjs.org/) - React framework
- [shadcn/ui](https://ui.shadcn.com/) - Component library
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Lucide Icons](https://lucide.dev/) - Icon library
- TypeScript - Type safety

## Getting Started

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The dashboard will be available at [http://localhost:3001](http://localhost:3001)

## Project Structure

```
dashboard/
├── app/
│   ├── globals.css          # Global styles & Tailwind
│   ├── layout.tsx            # Root layout
│   └── page.tsx             # Main dashboard page
├── components/
│   └── ui/
│       └── card.tsx          # shadcn/ui Card component
├── lib/
│   └── utils.ts             # Utility functions
├── public/                   # Static assets
├── next.config.js           # Next.js configuration
├── tailwind.config.ts       # Tailwind configuration
└── tsconfig.json            # TypeScript configuration
```

## Dashboard Sections

### Stats Overview
- **Total Equity**: Current account value
- **Total Trades**: Number of trades executed
- **Trading Volume**: Total volume (for airdrop tracking)
- **Active Bots**: Number of running bots

### Open Positions
Real-time monitoring of active positions:
- Market (BTC-USD, ETH-USD, etc.)
- Side (LONG/SHORT)
- Entry price and current price
- Unrealized P&L

### Recent Trades
Latest executed trades with:
- Entry/exit prices
- Realized P&L
- Execution time

### Bot Status
Current bot configuration:
- Strategy parameters (Supertrend + EMA)
- Risk management settings
- Exchange information (Extended, fees)

## Customization

### Colors & Theme
Edit `app/globals.css` to customize the color scheme:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  /* ... */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... */
}
```

### Adding Components
shadcn/ui components can be added with:

```bash
npx shadcn-ui@latest add button
npx shadcn-ui@latest add table
npx shadcn-ui@latest add chart
```

## Integration with Trading Bot

The dashboard is designed to integrate with the Extended connector:

```typescript
// Example: Connect to bot backend
import { ExtendedConnector } from '../src/exchanges/extended'

// Fetch real-time data
const connector = new ExtendedConnector({...})
await connector.connect()

const balance = await connector.getBalance()
const positions = await connector.getPositions()
const stats = await connector.getStats()
```

## Next Steps

### 1. Add Real-time Updates
Integrate WebSocket for live data:
- Use Extended WebSocket client
- Subscribe to position/account updates
- Auto-refresh stats every few seconds

### 2. Add Charts
Install chart library:
```bash
npm install recharts
```

Add price charts, P&L charts, and performance metrics.

### 3. Add Bot Controls
- Start/stop bot
- Adjust strategy parameters
- Emergency stop button
- Position management (close positions)

### 4. Add Multi-bot Support
- Tab view for multiple bots
- Aggregate stats across all bots
- Per-bot performance comparison

## Development

### Port Configuration
Dashboard runs on port 3001 to avoid conflicts with the main bot.

### Environment Variables
Create `.env.local` for API configuration:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000
```

## License

MIT

## Screenshots

Current dashboard includes:
- Clean, modern dark theme
- Responsive grid layout
- Real-time stats cards
- Position and trade tables
- Bot status overview

Ready for production deployment! 🚀
