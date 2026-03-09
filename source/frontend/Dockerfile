# Node runtime used to run Vite dev server inside Docker.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install

# Copy frontend source after deps.
COPY . .

EXPOSE 3000

# Launch Vite in host mode so it is reachable from host browser.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
