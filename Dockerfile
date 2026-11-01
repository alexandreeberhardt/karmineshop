FROM node:24-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/var

WORKDIR /app

COPY package.json ./
COPY server.js likes.js ./
COPY data ./data
COPY public ./public

RUN mkdir -p /app/var && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "server.js"]
