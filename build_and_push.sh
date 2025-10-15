#!/bin/bash
set -e

# Court Booking Manager - Build and Push Script
# Builds multi-platform Docker image and pushes to Docker Hub

USERNAME="ashayc"
IMAGE_NAME="court-booking-manager"
VERSION="v1.0.0"

echo "🚀 Building and pushing Court Booking Manager Docker image..."
echo "   Username: $USERNAME"
echo "   Image: $IMAGE_NAME"
echo "   Version: $VERSION"
echo ""

# Check if buildx builder exists, create if not
if ! docker buildx ls | grep -q multiplatform; then
    echo "📦 Creating multi-platform builder..."
    docker buildx create --name multiplatform --use
    docker buildx inspect --bootstrap
else
    echo "📦 Using existing multi-platform builder..."
    docker buildx use multiplatform
fi

# Login to Docker Hub
echo "🔐 Logging into Docker Hub..."
docker login

# Build and push multi-platform image
echo "🔨 Building multi-platform image..."
cd webapp

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t $USERNAME/$IMAGE_NAME:latest \
  -t $USERNAME/$IMAGE_NAME:$VERSION \
  --push \
  -f Dockerfile \
  ..

cd ..

echo ""
echo "✅ Successfully built and pushed:"
echo "   - $USERNAME/$IMAGE_NAME:latest"
echo "   - $USERNAME/$IMAGE_NAME:$VERSION"
echo ""
echo "🚀 To deploy, update your docker-compose.yml to use:"
echo "   image: $USERNAME/$IMAGE_NAME:latest"
echo ""
echo "📋 Verify the image:"
echo "   docker buildx imagetools inspect $USERNAME/$IMAGE_NAME:latest"