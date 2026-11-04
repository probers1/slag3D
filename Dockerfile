FROM node:20-bookworm-slim

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install system dependencies, Chromium for headless renders, and build tools for native SQLite
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    p7zip-full \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install all dependencies (including devDependencies required for vite build)
RUN npm install

# Copy application source code
COPY . .

# Build production frontend and bundled server
RUN npm run build

# Create persistent storage directories with secure ownership
RUN mkdir -p /data /uploads/thumbnails /uploads/models /uploads/tmp \
    && chown -R node:node /data /uploads \
    && chmod -R 750 /data /uploads

# Declare persistent volumes
VOLUME ["/data", "/uploads"]

# Expose server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# SECURITY FIX #1: Startup validation — the container WILL NOT start without valid secrets.
# Validation runs at container start (not build time) because the secrets are
# injected as runtime environment variables.
COPY ./startup-validation.js ./startup-validation.js
CMD ["sh", "-c", "node ./startup-validation.js && npm start"]