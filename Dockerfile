# ─── Build stage ───
FROM node:22-alpine@sha256:a0c54c2b3e42dfe0b10e13cd81c78c66e45ed5c1a98e13087e99f182afdd9e4b AS builder
WORKDIR /app
# Native addons (tree-sitter*) need a build toolchain to compile on alpine.
RUN apk add --no-cache python3 make g++
COPY package*.json .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
# Drop devDependencies but keep the already-compiled native binaries for prod.
RUN npm prune --omit=dev

# ─── Production stage ───
FROM node:22-alpine@sha256:a0c54c2b3e42dfe0b10e13cd81c78c66e45ed5c1a98e13087e99f182afdd9e4b
WORKDIR /app
COPY package*.json ./
# Reuse the pruned, pre-compiled node_modules from the builder — no recompile,
# so the production image needs no build toolchain.
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/dist/ ./dist/
COPY skills/ ./skills/
COPY templates/ ./templates/
COPY README.md ./

ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
