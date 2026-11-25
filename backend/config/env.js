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
  CLIENT_ORIGIN: z.string().url().default('http://localhost:3000'),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  // Set explicitly in isolated tests only; NODE_ENV never disables protection.
  DISABLE_RATE_LIMIT: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MOMO_ENV: z.enum(['sandbox', 'production']).optional().default('sandbox'),
  MOMO_BASE_URL: z.string().url().optional(),
  MOMO_CONSUMER_KEY: z.string().optional(),
  MOMO_CONSUMER_SECRET: z.string().optional(),
  MOMO_MERCHANT_ID: z.string().optional(),
  MOMO_API_USER: z.string().optional(),
  MOMO_API_KEY: z.string().optional(),
  MOMO_WEBHOOK_SECRET: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const names = [...new Set(parsed.error.issues.map((i) => i.path[0]))];
  console.error('Invalid or missing environment variables: ' + names.join(', '));
  process.exit(1);
}

module.exports = parsed.data;
