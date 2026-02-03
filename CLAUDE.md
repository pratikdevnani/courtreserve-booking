# Court Booking Manager

## Deployment

**Building Docker image:**
```bash
./build_and_push.sh         # Fast local build (~1-2 min, amd64 only)
./build_and_push.sh --push  # Build and push to Docker Hub (~3-4 min)
```

**Deploying/restarting the container:**
Always use docker-compose from ~/Desktop/containers to preserve volumes and network config:
```bash
cd ~/Desktop/containers
docker compose pull pickleball
docker compose up -d pickleball
```

**NEVER recreate the container manually with `docker run`** - this will:
- Use wrong volume mounts (data is in ~/Desktop/containers/pickleball-data, not ~/Desktop/courtreserve-data)
- Lose the Docker network connection to Caddy (containers_container_bridge), causing 502 errors
- The docker-compose.yml in ~/Desktop/containers has the correct configuration

## Database Operations

**CRITICAL - Database Migration Protocol:**

**BEFORE running ANY Prisma command:**
```bash
# 1. ALWAYS backup first
docker exec pickleball cp /app/data/dev.db /app/data/dev.db.backup-$(date +%Y%m%d-%H%M%S)

# 2. Verify backup exists
docker exec pickleball ls -lh /app/data/*.backup*
```

**Running migrations:**
```bash
# After backup, run migration
docker exec pickleball npx prisma db push --skip-generate

# Verify migration worked (check tables exist)
docker exec pickleball npx prisma db execute --stdin <<< "SELECT name FROM sqlite_master WHERE type='table';"
```

**If migration fails or destroys data:**
```bash
# Restore from latest backup
docker exec pickleball sh -c 'cp $(ls -t /app/data/*.backup* | head -1) /app/data/dev.db'
docker restart pickleball
```

**NEVER:**
- Run `npx prisma db push` without backing up first
- Assume Prisma will preserve data when schema doesn't match
- Run migrations during active bookings (wait for off-hours)
