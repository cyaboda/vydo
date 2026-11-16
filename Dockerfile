FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip pipx ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.local/bin:${PATH}"
RUN pipx install yt-dlp
WORKDIR /app
COPY package.json lib.mjs server.mjs ./
COPY public/ ./public/
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node","server.mjs"]
