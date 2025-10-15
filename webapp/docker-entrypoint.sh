#!/bin/sh
set -e

echo "🚀 Starting Court Booking Manager..."

# Ensure data directory exists
mkdir -p /app/data

# Initialize database with better error handling
echo "📊 Initializing database..."
if ! npx prisma migrate deploy 2>/dev/null; then
    echo "Migration failed, trying db push..."
    npx prisma db push --accept-data-loss
fi

# Generate Prisma client if needed
npx prisma generate

# Start Next.js server in background
echo "🌐 Starting web server..."
npm start &

# Wait for server to start
sleep 5

# Start scheduler
echo "⏰ Starting booking scheduler..."
npx tsx scripts/start-scheduler.ts &

echo "✅ Court Booking Manager is running!"
echo "   Web UI: http://localhost:3000"
echo "   Scheduler: Active (runs daily at noon)"

# Keep container running and forward signals
wait
