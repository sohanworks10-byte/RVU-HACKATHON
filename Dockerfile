FROM node:22-alpine

WORKDIR /app

COPY apps/backend/package.json ./package.json

RUN npm install --omit=dev

COPY apps/backend/ ./

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/index.js"]
