FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/ai-worker/package.json services/ai-worker/package.json
COPY services/ai-scheduler/package.json services/ai-scheduler/package.json
RUN npm install
ARG INTERNAL_API_URL=http://api:3101
ENV INTERNAL_API_URL=${INTERNAL_API_URL}
COPY . .
RUN npm run db:generate && npm run build

FROM build AS app
ENV NODE_ENV=production

FROM app AS worker
RUN apt-get update && apt-get install -y --no-install-recommends python3.11 libgomp1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1
