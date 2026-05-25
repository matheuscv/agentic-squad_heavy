import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config(); // carrega .env para que DATABASE_URL esteja disponível nas migrations

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
