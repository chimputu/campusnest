const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.string().default('development'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:3000')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const names = [...new Set(parsed.error.issues.map((i) => i.path[0]))];
  console.error('Invalid or missing environment variables: ' + names.join(', '));
  process.exit(1);
}

module.exports = parsed.data;
