# ─── Build stage ───
FROM node:22-alpine@sha256:a0c54c2b3e42dfe0b10e13cd81c78c66e45ed5c1a98e13087e99f182afdd9e4b AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ─── Production stage ───
FROM node:22-alpine@sha256:a0c54c2b3e42dfe0b10e13cd81c78c66e45ed5c1a98e13087e99f182afdd9e4b
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ ./dist/
COPY skills/ ./skills/
COPY templates/ ./templates/
COPY README.md ./

ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
