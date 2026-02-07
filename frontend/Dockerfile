# Build stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build


# Production stage
FROM node:20-alpine

WORKDIR /app

# install serve globally
RUN npm install -g serve

# copy build files
COPY --from=build /app/dist ./dist

# Cloud Run requires this
ENV PORT=8080

EXPOSE 8080

CMD ["serve", "-s", "dist", "-l", "8080"]
