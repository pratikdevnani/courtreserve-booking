---
description: Build, push Docker image and deploy to container with optional DB migration
---

# Deploy Skill

Build, push, and deploy the court booking manager.

## Instructions

Execute these steps in order:

### Step 1: Build and Push Docker Image

Run the build script to create and push the Docker image:

```bash
cd /home/ashayc/Desktop/courtreserve-booking && ./build_and_push.sh
```

This will:
- Build the Docker image for linux/amd64
- Push to Docker Hub (ashayc/court-booking-manager:latest)

Wait for the build to complete before proceeding.

### Step 2: Pull and Restart Container

Pull the latest image and restart the container:

```bash
cd /home/ashayc/Desktop/containers && docker compose pull pickleball && docker compose up -d pickleball
```

### Step 3: Ask About Database Changes

Ask the user: "Were there any database schema changes that need to be migrated?"

If YES, proceed with database migration:

1. First, backup the database:
```bash
docker exec pickleball cp /app/data/dev.db /app/data/dev.db.backup-$(date +%Y%m%d-%H%M%S)
```

2. Then run the migration (preserves existing data):
```bash
docker exec pickleball npx prisma db push --skip-generate
```

3. Verify tables exist:
```bash
docker exec pickleball npx prisma db execute --stdin <<< "SELECT name FROM sqlite_master WHERE type='table';"
```

### Step 4: Verify Deployment

Show recent container logs to verify everything is working:

```bash
docker logs pickleball --tail 30
```

## Important Notes

- Always use docker-compose (not docker run) to preserve volume mounts
- The `--skip-generate` flag prevents regenerating Prisma client (already in image)
- Database backups are stored in /app/data/ with timestamp suffix
- If migration fails, restore with: `docker exec pickleball sh -c 'cp $(ls -t /app/data/*.backup* | head -1) /app/data/dev.db' && docker restart pickleball`
