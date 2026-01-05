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
│   │   └── index.ts      # Position sizing, daily limits
│   └── utils/
│       ├── logger.ts     # Logging
│       └── exchange.ts   # Exchange connectors
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
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
    cooldownMinutes: 30
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

1. **Paper trade** - En az 1-2 ay paper trade yap
2. **Backtest** - Farklı parametrelerle backtest yap
3. **Optimize** - ATR multiplier, ADX threshold ayarla
4. **Liquidation heatmap** - Coinglass API entegrasyonu ekle
5. **Multi-timeframe** - 1h confirmation ekle
6. **Telegram alerts** - Bildirim sistemi ekle

## ⚠️ Uyarılar

- Bu bir iskelet/başlangıç noktasıdır
- Gerçek para ile kullanmadan önce kapsamlı test yapın
- Hyperliquid SDK entegrasyonu tamamlanmalı
- Slippage, MEV, gas maliyetleri hesaba katılmalı
- **ASLA kaybetmeyi göze alamayacağınız parayla trade yapmayın**

## Lisans

MIT
