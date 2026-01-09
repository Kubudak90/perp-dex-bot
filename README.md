# Perp DEX Bot 🤖

Supertrend + EMA + ADX + Funding Filter stratejisi ile çalışan perpetual DEX trading botu.

## Strateji Özeti

```
┌─────────────────────────────────────────────────────────────┐
│                    ENTRY CONDITIONS                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  LONG:                           SHORT:                      │
│  ├─ Supertrend = LONG            ├─ Supertrend = SHORT       │
│  ├─ EMA50 > EMA200               ├─ EMA50 < EMA200           │
│  ├─ ADX > 20                     ├─ ADX > 20                 │
│  ├─ ATR Percentile 20-90%        ├─ ATR Percentile 20-90%    │
│  └─ Funding not extreme +        └─ Funding not extreme -    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    EXIT CONDITIONS                           │
├─────────────────────────────────────────────────────────────┤
│  ├─ Supertrend flip (main signal)                           │
│  ├─ Stop Loss hit (ATR-based)                               │
│  ├─ Take Profit hit (1:1.5 RR)                              │
│  └─ Extreme funding against position                        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    RISK MANAGEMENT                           │
├─────────────────────────────────────────────────────────────┤
│  ├─ Max 3 trades/day                                        │
│  ├─ Max 3% daily drawdown → bot stops                       │
│  ├─ 30 min cooldown after loss                              │
│  ├─ Position size: 1% risk per trade                        │
│  └─ ATR-based stop loss (1.5x ATR)                          │
└─────────────────────────────────────────────────────────────┘
```

## Kurulum

```bash
# Clone veya dosyaları kopyala
cd perp-dex-bot

# Dependencies
npm install

# Build
npm run build
```

## Kullanım

### 1. Paper Trading (Önerilen Başlangıç)

```bash
# .env dosyası oluştur
cp .env.example .env

# Paper mode'da başlat
MODE=paper PAPER_BALANCE=10000 npm run dev
```

### 2. Backtest

```bash
# Stratejiyi tarihsel veriyle test et
npm run backtest
```

### 3. Live Trading (DİKKAT!)

```bash
# .env'yi düzenle
PRIVATE_KEY=xxx
WALLET_ADDRESS=0x...
MODE=live

# Başlat
npm run dev
```

## Dosya Yapısı

```
perp-dex-bot/
├── src/
│   ├── index.ts          # Ana giriş noktası
│   ├── bot.ts            # Bot engine
│   ├── backtest.ts       # Backtest engine
│   ├── types/
│   │   └── index.ts      # Type definitions
│   ├── indicators/
│   │   └── index.ts      # Supertrend, EMA, ADX, ATR
│   ├── strategies/
│   │   └── index.ts      # Signal generation logic
│   ├── risk/
│   │   └── index.ts      # Advanced risk management
│   └── utils/
│       ├── logger.ts        # Logging
│       ├── exchange.ts      # Exchange connectors
│       ├── retry.ts         # Retry logic & circuit breaker
│       ├── errors.ts        # Custom error types
│       ├── config.ts        # Config validation
│       ├── websocket.ts     # WebSocket manager
│       ├── hyperliquid.ts   # Hyperliquid order manager
│       ├── notifications.ts # Telegram/Discord alerts
│       ├── database.ts      # SQLite trade history
│       └── analytics.ts     # Performance metrics
├── tests/
│   ├── indicators.test.ts      # Indicator tests
│   ├── risk.test.ts            # Risk management tests
│   ├── retry.test.ts           # Retry logic tests
│   ├── websocket.test.ts       # WebSocket tests
│   └── advanced-risk.test.ts   # Advanced risk tests
├── package.json
├── tsconfig.json
├── jest.config.js
├── .eslintrc.json
├── .prettierrc.json
├── .env.example
└── README.md
```

## ✨ Yeni Özellikler (Phases 1-3)

### Phase 1: Temel Altyapı
- **Error Handling**: Exponential backoff retry, circuit breaker, rate limiter
- **Testing**: Jest framework, unit tests (%70 coverage threshold)
- **Config Validation**: Comprehensive environment validation
- **Code Quality**: ESLint + Prettier integration

### Phase 2: Trading Reliability
- **WebSocket Manager**: Real-time market data with auto-reconnection
- **Hyperliquid SDK**: EIP-712 signing, slippage protection, IOC orders
- **Advanced Risk Management**:
  - Trailing stops (automatic SL adjustment)
  - Consecutive loss tracking
  - Portfolio heat monitoring
  - Max hold time enforcement

### Phase 3: Monitoring & Analytics
- **Notifications**: Telegram/Discord alerts for trades, risks, errors
- **Database**: SQLite trade history with performance tracking
- **Analytics**:
  - Sharpe, Sortino, Calmar ratios
  - Drawdown analysis
  - Equity curves
  - Win/loss streaks
  - Exit reason breakdown

## Bildirim Sistemi

### Telegram Kurulumu
```bash
# .env dosyasına ekle
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Discord Kurulumu
```bash
# .env dosyasına ekle
DISCORD_WEBHOOK_URL=your_webhook_url
```

Bildirimler:
- Trade açılış/kapanış
- Risk uyarıları
- Günlük özet
- Hata bildirimleri

## Database & Analytics

Trade geçmişi otomatik olarak `data/trades.db` dosyasına kaydedilir:

```typescript
// Performance metrics
const analytics = new AnalyticsService();
const stats = analytics.calculatePerformanceStats(trades, initialEquity);
console.log(analytics.formatStats(stats));

// CSV export
database.exportToCSV('./exports/trades.csv');
```

## Testing

```bash
# Tüm testleri çalıştır
npm test

# Coverage raporu
npm test -- --coverage

# Belirli test dosyası
npm test indicators.test.ts
```

## Konfigürasyon

`src/index.ts` içindeki `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: BotConfig = {
  symbol: 'BTC',
  timeframe: '15m',
  leverage: 3,

  // Supertrend
  supertrendPeriod: 10,
  supertrendMultiplier: 3,

  // EMA
  emaFastPeriod: 50,
  emaSlowPeriod: 200,

  // ADX
  adxPeriod: 14,
  adxThreshold: 20,

  // Funding
  fundingThreshold: 0.0005, // 0.05%
  useFundingFilter: true,

  // Volatility regime
  atrPeriod: 14,
  atrLookback: 100,
  minAtrPercentile: 20,
  maxAtrPercentile: 90,

  // Risk
  risk: {
    maxPositionSize: 20,      // Max %20 equity
    maxDailyLoss: 3,          // Max %3 DD
    maxDailyTrades: 3,        // Max 3 trade/day
    riskRewardRatio: 1.5,     // 1:1.5 RR
    stopLossAtrMultiplier: 1.5,
    cooldownMinutes: 30,

    // Advanced (opsiyonel)
    useTrailingStop: true,        // Trailing stop kullan
    trailingStopDistance: 2,      // %2 trailing distance
    maxConsecutiveLosses: 3,      // Max 3 ardışık loss
    maxPortfolioHeat: 10,         // Max %10 risk exposure
    maxHoldTimeHours: 24          // Max 24 saat pozisyon
  }
};
```

## Yeni Exchange Ekleme

`src/utils/exchange.ts` içindeki `IExchange` interface'ini implement et:

```typescript
export class GMXConnector implements IExchange {
  async connect(): Promise<void> { /* ... */ }
  async getCandles(): Promise<Candle[]> { /* ... */ }
  async openPosition(): Promise<{ orderId: string; avgPrice: number }> { /* ... */ }
  // ... diğer metodlar
}
```

## Sonraki Adımlar

1. ✅ **Telegram alerts** - Tamamlandı
2. ✅ **Database & Analytics** - Tamamlandı
3. ✅ **Advanced Risk Management** - Tamamlandı
4. **Paper trade** - En az 1-2 ay paper trade yap
5. **Backtest** - Farklı parametrelerle backtest yap
6. **Optimize** - ATR multiplier, ADX threshold ayarla
7. **Liquidation heatmap** - Coinglass API entegrasyonu ekle
8. **Multi-timeframe** - 1h confirmation ekle

## ⚠️ Uyarılar

- ✅ Hyperliquid SDK entegrasyonu tamamlandı (Phase 2)
- ✅ Slippage protection eklendi (Phase 2)
- ✅ Advanced risk management eklendi (Phase 2)
- Gerçek para ile kullanmadan önce kapsamlı test yapın
- MEV ve gas maliyetleri hesaba katılmalı
- **ASLA kaybetmeyi göze alamayacağınız parayla trade yapmayın**

## Lisans

MIT
