# Extended Exchange - Python SDK Integration

Bu klasör Extended Exchange'de order signing için Python SDK entegrasyonunu içerir.

## Kurulum

### 1. Python SDK'yı Kur

```bash
npm run setup:python
```

Veya manuel:

```bash
pip3 install -r python/requirements.txt
```

### 2. Environment Variables

`.env` dosyanızda şunları ayarlayın:

```bash
# Extended API Key (https://app.extended.exchange/settings/api-keys)
EXTENDED_API_KEY=your_api_key_here

# Extended Vault ID (account info'dan alın)
EXTENDED_VAULT=12345

# Starknet private key
STARKNET_PRIVATE_KEY=0x...

# Testnet/Mainnet
USE_TESTNET=true
```

## Nasıl Çalışır?

### 1. Python Script (`extended_order_signer.py`)

x10-python-trading SDK kullanarak:
- SNIP12 signature generation
- Order placement
- Order cancellation

### 2. TypeScript Bridge (`python-bridge.ts`)

TypeScript'ten Python'u subprocess olarak çağırır:
```typescript
const bridge = new PythonBridge(apiKey, privateKey, vault, testnet);
const result = await bridge.placeOrder(orderRequest);
```

### 3. Connector Integration

Connector otomatik olarak Python bridge'i kullanır:
```typescript
// Python bridge varsa otomatik kullanılır
await connector.openPosition({
    symbol: 'BTC-USD',
    side: 'LONG',
    size: 0.01,
    stopLoss: 60000,
    takeProfit: 65000
});
```

## Test

### Python SDK Kontrolü

```bash
python3 -c "import x10; print('OK')"
```

### Extended Connector Test

```bash
npm run test:extended
```

## Order Placement Örneği

### Limit Order

```typescript
await connector.openPosition({
    symbol: 'BTC-USD',
    side: 'LONG',
    size: 0.01,
    price: 60000,  // Limit price
    stopLoss: 58000,
    takeProfit: 65000
});
```

### Market Order (IOC)

```typescript
await connector.openPosition({
    symbol: 'BTC-USD',
    side: 'LONG',
    size: 0.01,
    // price belirtilmezse market order (IOC)
});
```

## Troubleshooting

### Python SDK Yok

```bash
❌ Error: x10-python-trading not installed
```

**Çözüm:**
```bash
pip3 install x10-python-trading
```

### Vault ID Bulunamıyor

Extended account info endpoint'inden vault ID'nizi alın:
```bash
GET /api/v1/user/account/info
```

Response:
```json
{
  "data": {
    "vault": "12345",  // Bu sizin vault ID'niz
    "starkKey": "0x...",
    "tradingEnabled": true
  }
}
```

### Private Key Hatası

Starknet private key'iniz 0x ile başlamalı:
```bash
STARKNET_PRIVATE_KEY=0x1234567890abcdef...
```

## Güvenlik

⚠️ **ÖNEMLİ:**
- Private key'leri **ASLA** git'e commit etmeyin
- `.env` dosyası `.gitignore`'da
- Production'da environment variables kullanın

## API Rate Limits

Extended API:
- 1000 requests/minute
- Rate limiter otomatik aktif

## Daha Fazla Bilgi

- Extended Docs: https://docs.extended.exchange
- Python SDK: https://github.com/extended-exchange/x10-python-trading
- Starknet: https://starknet.io
