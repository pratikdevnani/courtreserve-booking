# Multi-stage build for Court Booking Manager Webapp
# Pure TypeScript implementation - no Python dependencies

# Stage 1: Build Next.js application
FROM node:20-slim AS builder

WORKDIR /app/webapp

# Copy package files
COPY webapp/package*.json ./
COPY webapp/prisma ./prisma/

# Install dependencies
RUN npm ci

# Install OpenSSL for Prisma compatibility
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Generate Prisma client
RUN npx prisma generate

# Copy webapp source code
COPY webapp/ ./

# Build Next.js app
RUN npm run build

# Stage 2: Production image
FROM node:20-slim AS runner

WORKDIR /app

# Install system dependencies (minimal - no Python needed)
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy built Next.js app from builder
COPY --from=builder /app/webapp/.next ./.next
COPY --from=builder /app/webapp/node_modules ./node_modules
COPY --from=builder /app/webapp/package*.json ./
COPY --from=builder /app/webapp/prisma ./prisma

# Copy additional required files
COPY webapp/next.config.js ./
COPY webapp/postcss.config.js ./
COPY webapp/tailwind.config.ts ./
COPY webapp/tsconfig.json ./

# Copy application code
COPY webapp/app ./app
COPY webapp/lib ./lib
COPY webapp/scripts ./scripts

# Create directories for data persistence
RUN mkdir -p /app/data /app/cookies

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:./data/dev.db"
ENV OPENSSL_CONF=/etc/ssl/
ENV LOG_LEVEL=INFO

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/accounts', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Copy and set up entrypoint script
COPY webapp/docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
