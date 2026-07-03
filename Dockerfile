# Multi-stage build for the Next.js app. Container = the on-prem deliverable
# ODMs require (their spec/impl docs never leave their network).
FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app ./
EXPOSE 3000
CMD ["npm", "start"]
