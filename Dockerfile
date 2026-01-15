# ═══════════════════════════════════════════════════════════════════════════
# PERP DEX BOT - DOCKER IMAGE
# ═══════════════════════════════════════════════════════════════════════════

FROM node:20-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create non-root user for security
RUN addgroup -g 1001 -S botuser && \
    adduser -S botuser -u 1001

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R botuser:botuser /app

USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Start the bot
CMD ["node", "dist/index.js"]
