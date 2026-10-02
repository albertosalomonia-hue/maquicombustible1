import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no carga .env solo: Next usa .env.local, así que lo leemos aquí para el CLI.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
