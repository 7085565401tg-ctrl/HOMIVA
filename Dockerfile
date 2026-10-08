FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 HOMIVA_DATA_DIR=/var/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /var/data && chown node:node /var/data
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 4174
CMD ["npm", "start"]
