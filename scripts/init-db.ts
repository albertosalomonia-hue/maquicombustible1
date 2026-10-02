import { config } from "dotenv";
config({ path: ".env.local" });
config();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inicializarBaseDeDatos } = require("../backend/schema");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require("../backend/db");

inicializarBaseDeDatos()
  .then(() => console.log("Base de datos inicializada"))
  .catch((e: Error) => { console.error("Error:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
