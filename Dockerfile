FROM node:22-slim

RUN groupadd -r -g 1001 botuser && useradd -r -u 1001 -g botuser -d /app -s /bin/bash botuser

WORKDIR /app

RUN mkdir -p /app/data && chown -R botuser:botuser /app/data

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget \
        curl \
        ca-certificates \
        graphicsmagick \
        ghostscript \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

COPY --chown=botuser:botuser package*.json ./

USER botuser

RUN npm ci --omit=dev && \
    npm cache clean --force
COPY --chown=botuser:botuser . .

CMD ["node", "./src/bot.js"]