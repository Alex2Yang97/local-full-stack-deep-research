FROM node:20-slim

WORKDIR /app

# Install pnpm with specific version
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

# Add packageManager field to package.json
RUN echo '{"packageManager": "pnpm@10.12.1"}' > .npmrc

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install

# Copy the rest of the application
COPY . .

# Build the application
RUN pnpm build

# Expose the port
EXPOSE 3000

# Command to run the application
CMD ["pnpm", "start"] 