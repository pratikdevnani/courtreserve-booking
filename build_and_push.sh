#!/bin/bash
set -e

# Court Booking Manager - Build Script
# Builds and pushes Docker image to Docker Hub (default) or builds locally
#
# v2.0.0 - Pure TypeScript implementation (no Python dependencies)
#   - Native CourtReserve API client
#   - Modular scheduler (noon + polling modes)
#   - Configurable logging (LOG_LEVEL env var)
#   - Push notifications via ntfy.sh
#
# Usage:
#   ./build_and_push.sh          # Build and push to Docker Hub (default)
#   ./build_and_push.sh --local  # Build for local Docker only (faster)

USERNAME="ashayc"
IMAGE_NAME="court-booking-manager"
VERSION="v2.0.0"

# Check if --local flag is provided
LOCAL_ONLY=false
if [ "$1" = "--local" ]; then
    LOCAL_ONLY=true
fi

if [ "$LOCAL_ONLY" = true ]; then
    echo "🚀 Building Court Booking Manager for local Docker..."
    echo "   Platform: linux/amd64 (native)"
    echo "   Image: $IMAGE_NAME"
    echo "   Version: $VERSION"
    echo ""

    # Build and load locally (much faster)
    echo "🔨 Building image..."
    cd webapp

    docker build \
      -t $USERNAME/$IMAGE_NAME:latest \
      -t $USERNAME/$IMAGE_NAME:$VERSION \
      -f Dockerfile \
      ..

    cd ..

    echo ""
    echo "✅ Successfully built locally:"
    echo "   - $USERNAME/$IMAGE_NAME:latest"
    echo "   - $USERNAME/$IMAGE_NAME:$VERSION"
    echo ""
    echo "🐳 Verify with: docker images | grep $IMAGE_NAME"
    echo ""
    echo "🚀 To restart container:"
    echo "   cd ~/Desktop/containers && docker compose up -d pickleball"
else
    echo "🚀 Building and pushing Court Booking Manager to Docker Hub..."
    echo "   Platform: linux/amd64 only"
    echo "   Username: $USERNAME"
    echo "   Image: $IMAGE_NAME"
    echo "   Version: $VERSION"
    echo ""

    # Login to Docker Hub
    echo "🔐 Logging into Docker Hub..."
    docker login

    # Build and push for amd64 only with cache optimization
    echo "🔨 Building and pushing image..."
    cd webapp

    docker buildx build \
      --platform linux/amd64 \
      -t $USERNAME/$IMAGE_NAME:latest \
      -t $USERNAME/$IMAGE_NAME:$VERSION \
      --cache-from type=registry,ref=$USERNAME/$IMAGE_NAME:cache \
      --cache-to type=registry,ref=$USERNAME/$IMAGE_NAME:cache,mode=max \
      --push \
      -f Dockerfile \
      ..

    cd ..

    echo ""
    echo "✅ Successfully built and pushed:"
    echo "   - $USERNAME/$IMAGE_NAME:latest"
    echo "   - $USERNAME/$IMAGE_NAME:$VERSION"
    echo ""
    echo "📋 Verify the image:"
    echo "   docker buildx imagetools inspect $USERNAME/$IMAGE_NAME:latest"
    echo ""
    echo "🚀 To deploy:"
    echo "   cd ~/Desktop/containers && docker compose pull pickleball && docker compose up -d pickleball"
fi