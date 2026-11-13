# One image: builds the shared package, the server and the web app, then the server serves both.
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=development
COPY package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build:deploy
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:deploy"]
