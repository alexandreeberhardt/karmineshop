FROM node:24-slim

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
