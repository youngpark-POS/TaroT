import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default('postgres://tarot:tarot@localhost:5432/tarot'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AI_MODE: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  SPREAD_MODEL: z.string().default('gpt-5.6-luna'),
  READING_MODEL: z.string().default('gpt-5.6-terra'),
  DATA_ENCRYPTION_KEY: z.string().min(16).default('local-development-encryption-key-change-me'),
  SESSION_HMAC_KEY: z.string().min(16).default('local-development-session-key-change-me'),
  RATE_LIMIT_HMAC_KEY: z.string().min(16).default('local-development-rate-limit-key'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = envSchema.parse(env);
  if (config.AI_MODE === 'openai' && !config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when AI_MODE=openai.');
  }
  return config;
}

const encryptionKey = (secret: string) => {
  const decoded = Buffer.from(secret, 'base64');
  return decoded.length === 32 ? decoded : createHash('sha256').update(secret).digest();
};

export function encrypt(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decrypt<T>(payload: string, secret: string): T {
  const [ivText, tagText, ciphertextText] = payload.split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted payload.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plain) as T;
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function keyedHash(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
