FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next.js leaves static and public out of standalone, so copy them in
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# 2.7 placed late so a new SHA only rebuilds these metadata layers
ARG COMMIT_SHA=unknown
ENV APP_COMMIT_SHA=$COMMIT_SHA
LABEL org.opencontainers.image.revision=$COMMIT_SHA

USER node
EXPOSE 3000
# JSON form makes node process 1, so it gets the stop signal directly
CMD ["node", "server.js"]