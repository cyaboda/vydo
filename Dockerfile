FROM node:24.11.0-bookworm-slim
COPY requirements.txt /tmp/requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/yt-dlp/bin:${PATH}"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node lib.mjs engine.mjs media-errors.mjs analysis.mjs turnstile.mjs jobs.mjs server.mjs store.mjs auth.mjs security.mjs ./
COPY --chown=node:node migrations/ ./migrations/
COPY --chown=node:node certs/ ./certs/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node scripts/check-auth.mjs scripts/check-production.mjs ./scripts/
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=3000 TMPDIR=/tmp DATA_DIR=/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
