FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3400
ENV HOST=0.0.0.0

WORKDIR /bridge

RUN corepack enable \
  && addgroup --system --gid 10001 bridge \
  && adduser --system --uid 10001 --ingroup bridge bridge

COPY docker/mcp-bridge/package.json docker/mcp-bridge/pnpm-lock.yaml docker/mcp-bridge/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --chown=bridge:bridge docker/mcp-bridge/*.mjs ./

USER bridge

EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3400/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
