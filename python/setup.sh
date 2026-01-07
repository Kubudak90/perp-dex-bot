#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Python SDK Setup Script
# Installs x10-python-trading SDK for Extended exchange integration
# ═══════════════════════════════════════════════════════════════════════════

set -e

echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║           Extended Exchange - Python SDK Setup                        ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.8 or higher."
    exit 1
fi

PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo "✅ Python found: $PYTHON_VERSION"
echo ""

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 not found. Please install pip3."
    exit 1
fi

echo "📦 Installing Python dependencies..."
echo ""

# Install requirements
pip3 install -r python/requirements.txt

echo ""
echo "✅ Python SDK setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Get your Extended API key from: https://app.extended.exchange/settings/api-keys"
echo "   2. Add to .env file:"
echo "      EXTENDED_API_KEY=your_api_key_here"
echo "      EXTENDED_VAULT=your_vault_id"
echo "      STARKNET_PRIVATE_KEY=0x..."
echo "   3. Test connection: npm run test:extended"
echo ""
