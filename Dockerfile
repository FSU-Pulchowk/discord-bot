FROM node:22-slim

RUN groupadd -r botuser && useradd -r -g botuser -d /app -s /bin/bash botuser

WORKDIR /app

RUN chown -R botuser:botuser /app

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