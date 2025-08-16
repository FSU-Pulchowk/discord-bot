FROM node:20-slim

RUN groupadd -r botuser && useradd -r -g botuser -d /app -s /bin/bash botuser

# Set the working directory inside the container
WORKDIR /app

RUN chown -R botuser:botuser /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget \
        curl \
        ca-certificates \
        fonts-liberation \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        xdg-utils \
        graphicsmagick \
        ghostscript \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --chown=botuser:botuser package*.json ./

USER botuser

RUN npm ci --omit=dev && \
    npm cache clean --force
COPY --chown=botuser:botuser . .

CMD ["node", "./src/bot.js"]