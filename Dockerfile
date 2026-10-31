# Build: the React app (vite) and the server bundle (esbuild) need dev dependencies.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Run: node:sqlite is built in and ts-fsrs is bundled, so no node_modules at all.
FROM node:26-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
USER node
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "dist/server/main.js"]
