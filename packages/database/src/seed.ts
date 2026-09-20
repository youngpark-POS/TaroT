import { cards as cardContent, CONTENT_VERSION, spreads as spreadContent } from '@tarot/content';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { cards, contentVersions, spreads } from './schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
try {
  const existing = await db
    .select()
    .from(contentVersions)
    .where(eq(contentVersions.version, CONTENT_VERSION));
  if (existing.length > 0) {
    console.log(`Content ${CONTENT_VERSION} is already seeded.`);
  } else {
    await db.transaction(async (tx) => {
      await tx.insert(contentVersions).values({ version: CONTENT_VERSION });
      await tx
        .insert(cards)
        .values(
          cardContent.map((card) => ({ id: card.id, contentVersion: CONTENT_VERSION, data: card })),
        )
        .onConflictDoUpdate({
          target: cards.id,
          set: { contentVersion: CONTENT_VERSION, data: sql`excluded.data` },
        });
      await tx
        .insert(spreads)
        .values(
          spreadContent.map((spread) => ({
            id: spread.id,
            contentVersion: CONTENT_VERSION,
            data: spread,
          })),
        )
        .onConflictDoUpdate({
          target: spreads.id,
          set: { contentVersion: CONTENT_VERSION, data: sql`excluded.data` },
        });
    });
    console.log(`Seeded ${cardContent.length} cards and ${spreadContent.length} spreads.`);
  }
} finally {
  await pool.end();
}
