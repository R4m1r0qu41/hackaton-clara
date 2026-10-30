FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY rag ./rag
COPY data/reca ./data/reca
RUN mkdir -p /app/rag/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
