# Stage 1: Build application
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install OpenSSL before Prisma Client generation
RUN apt-get update && apt-get install -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma Client
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# Stage 2: Production image
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install OpenSSL in runtime image too
RUN apt-get update && apt-get install -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY public ./public

EXPOSE 3000

CMD ["node", "dist/api/server.js"]
