#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# PERP DEX BOT - VPS DEPLOYMENT SCRIPT
# ═══════════════════════════════════════════════════════════════════════════

set -e

echo "🚀 Perp DEX Bot Deployment"
echo "═══════════════════════════════════════"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Detect deployment method
echo ""
echo "Select deployment method:"
echo "1) Docker (recommended)"
echo "2) PM2 (direct Node.js)"
read -p "Enter choice [1-2]: " choice

case $choice in
    1)
        echo ""
        echo -e "${YELLOW}📦 Deploying with Docker...${NC}"

        # Check if Docker is installed
        if ! command -v docker &> /dev/null; then
            echo -e "${RED}Docker not found. Installing...${NC}"
            curl -fsSL https://get.docker.com -o get-docker.sh
            sudo sh get-docker.sh
            sudo usermod -aG docker $USER
            rm get-docker.sh
            echo -e "${GREEN}Docker installed! Please logout and login again, then re-run this script.${NC}"
            exit 0
        fi

        # Check if docker-compose is available
        if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
            echo -e "${RED}Docker Compose not found. Installing...${NC}"
            sudo apt-get update
            sudo apt-get install -y docker-compose-plugin
        fi

        # Create directories
        mkdir -p data logs

        # Build and run
        echo "Building Docker image..."
        docker compose build

        echo "Starting container..."
        docker compose up -d

        echo ""
        echo -e "${GREEN}✅ Bot deployed with Docker!${NC}"
        echo ""
        echo "Useful commands:"
        echo "  docker compose logs -f     # View logs"
        echo "  docker compose restart     # Restart bot"
        echo "  docker compose stop        # Stop bot"
        echo "  docker compose down        # Remove container"
        ;;

    2)
        echo ""
        echo -e "${YELLOW}📦 Deploying with PM2...${NC}"

        # Check if Node.js is installed
        if ! command -v node &> /dev/null; then
            echo -e "${RED}Node.js not found. Installing...${NC}"
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        fi

        # Check if PM2 is installed
        if ! command -v pm2 &> /dev/null; then
            echo "Installing PM2..."
            sudo npm install -g pm2
        fi

        # Create directories
        mkdir -p logs

        # Install dependencies
        echo "Installing dependencies..."
        npm ci

        # Build
        echo "Building TypeScript..."
        npm run build

        # Start with PM2
        echo "Starting bot..."
        pm2 start ecosystem.config.js --env production

        # Save PM2 process list
        pm2 save

        # Setup PM2 to start on boot
        echo "Setting up auto-start..."
        pm2 startup | tail -n 1 | bash

        echo ""
        echo -e "${GREEN}✅ Bot deployed with PM2!${NC}"
        echo ""
        echo "Useful commands:"
        echo "  pm2 logs perp-dex-bot      # View logs"
        echo "  pm2 restart perp-dex-bot   # Restart bot"
        echo "  pm2 stop perp-dex-bot      # Stop bot"
        echo "  pm2 monit                  # Monitor dashboard"
        ;;

    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo "═══════════════════════════════════════"
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "⚠️  Important: Make sure your .env has correct settings:"
echo "   - MODE=paper (for testing) or MODE=live (real trading)"
echo "   - PRIVATE_KEY and WALLET_ADDRESS for live trading"
echo "   - Telegram/Discord tokens for notifications"
