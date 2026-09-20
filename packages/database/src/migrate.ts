import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const sql = await readFile(resolve(import.meta.dirname, '../migrations/001_initial.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database migration complete.');
} finally {
  await pool.end();
}
