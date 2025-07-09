FROM node:20-slim
WORKDIR /app
RUN apt-get update && \
    apt-get install -y graphicsmagick && \
    rm -rf /var/lib/apt/lists/* # Clean up apt cache to keep image small
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "./src/bot.js"]