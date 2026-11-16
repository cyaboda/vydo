FROM node:22-bookworm-slim

# Node 22 also provides the JS runtime required by modern yt-dlp YouTube extractors.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip pipx ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.local/bin:${PATH}"
RUN pipx install yt-dlp && pipx inject yt-dlp yt-dlp-ejs \
    && yt-dlp --version && ffmpeg -version && node --version

WORKDIR /app
COPY package.json lib.mjs server.mjs ./
COPY public/ ./public/
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
USER root
CMD ["node", "server.mjs"]
