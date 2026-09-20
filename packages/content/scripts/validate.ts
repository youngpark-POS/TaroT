import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cardSchema, spreadSchema } from '@tarot/contracts';
import { cards, spreads } from '../src/index.js';

const root = resolve(import.meta.dirname, '../../..');
const assets = resolve(root, 'apps/web/public/cards');

if (cards.length !== 78 || new Set(cards.map((card) => card.id)).size !== 78) {
  throw new Error('Card catalog must contain 78 unique cards.');
}
cards.forEach((card) => cardSchema.parse(card));
spreads.forEach((spread) => {
  spreadSchema.parse(spread);
  if (spread.positions.length !== spread.cardCount) throw new Error(`Invalid spread ${spread.id}`);
});

const manifestPath = resolve(root, 'packages/content/assets/provenance.json');
try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    files: Array<{ id: string; license: string }>;
  };
  if (manifest.files.length !== 79)
    throw new Error('Asset manifest must contain 78 cards and one back.');
  for (const entry of manifest.files) {
    if (!entry.license.toLowerCase().includes('public domain'))
      throw new Error(`Non-public-domain asset: ${entry.id}`);
    await access(resolve(assets, `${entry.id}.webp`));
  }
  console.log('Content and 79 public-domain assets are valid.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.warn(
      'Asset manifest is not present. Run pnpm content:fetch before a production build.',
    );
  } else {
    throw error;
  }
}
