FROM node:22-bookworm-slim AS build-info

WORKDIR /workspace

COPY package.json ./
COPY scripts/write-build-info.mjs ./scripts/write-build-info.mjs
COPY .git ./.git

RUN node scripts/write-build-info.mjs --output /build-info.json

FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build-info /build-info.json ./build-info.json
COPY package.json package-lock.json ./
COPY src ./src

RUN mkdir -p /app/data/certs \
  && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "const http=require('node:http');const port=Number(process.env.HTTP_PORT||3000);const req=http.get({host:'127.0.0.1',port,path:'/healthz',timeout:3000},res=>{process.exit(res.statusCode===200?0:1)});req.on('timeout',()=>{req.destroy();process.exit(1)});req.on('error',()=>process.exit(1));"

CMD ["node", "src/index.js"]
