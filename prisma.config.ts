import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no carga .env solo: Next usa .env.local, así que lo leemos aquí para el CLI.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // `prisma generate` (postinstall/build en Vercel) no se conecta a la base, pero exige una
    // URL: sin DATABASE_URL se usa un valor de relleno. El runtime lee la variable real.
    url: process.env.DATABASE_URL ?? "mysql://build:build@localhost:3306/build",
  },
});
