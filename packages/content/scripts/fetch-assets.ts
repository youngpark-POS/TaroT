import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { cards, sourceFileForCard } from '../src/index.js';

type ImageInfo = {
  url: string;
  thumburl?: string;
  mime: string;
  width: number;
  height: number;
  extmetadata?: Record<string, { value: string }>;
};

const api = 'https://commons.wikimedia.org/w/api.php';
const backTitle = 'Waite–Smith Tarot Roses and Lilies cropped.jpg';
const requested = [
  ...cards.map((card) => ({ id: card.id, title: sourceFileForCard(card) })),
  { id: 'card-back', title: backTitle },
];
const root = resolve(import.meta.dirname, '../../..');
const outputDir = resolve(root, 'apps/web/public/cards');
const manifestDir = resolve(root, 'packages/content/assets');
await mkdir(outputDir, { recursive: true });
await mkdir(manifestDir, { recursive: true });

const batches = [requested.slice(0, 40), requested.slice(40)];
const found = new Map<string, { title: string; info: ImageInfo }>();
for (const batch of batches) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    redirects: '1',
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '640',
    titles: batch.map((item) => `File:${item.title}`).join('|'),
  });
  const response = await fetch(`${api}?${params}`);
  if (!response.ok) throw new Error(`Wikimedia API failed: ${response.status}`);
  const data = (await response.json()) as {
    query?: {
      pages?: Record<string, { title: string; missing?: boolean; imageinfo?: ImageInfo[] }>;
    };
  };
  for (const page of Object.values(data.query?.pages ?? {})) {
    if (page.missing || !page.imageinfo?.[0]) continue;
    found.set(page.title.replace(/^File:/, ''), { title: page.title, info: page.imageinfo[0] });
  }
}

const manifestFiles = [];
for (const item of requested) {
  const exact = found.get(item.title);
  const loose =
    exact ??
    [...found.entries()].find(([title]) => title.toLowerCase() === item.title.toLowerCase())?.[1];
  if (!loose) throw new Error(`Missing Wikimedia file: ${item.title}`);
  const license = loose.info.extmetadata?.LicenseShortName?.value ?? '';
  const usage = loose.info.extmetadata?.UsageTerms?.value ?? '';
  const licenseText = `${license} ${usage}`.trim();
  if (!licenseText.toLowerCase().includes('public domain')) {
    throw new Error(`Refusing non-public-domain file ${item.title}: ${licenseText}`);
  }
  if (!loose.info.mime.startsWith('image/') || loose.info.width < 250 || loose.info.height < 400) {
    throw new Error(`Invalid image metadata for ${item.title}`);
  }
  const sourceUrl = loose.info.thumburl ?? loose.info.url;
  const imageResponse = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'TaroT/0.1 content-acquisition' },
  });
  if (!imageResponse.ok) throw new Error(`Image download failed for ${item.title}`);
  const input = Buffer.from(await imageResponse.arrayBuffer());
  const normalized = sharp(input).resize({ width: 500, withoutEnlargement: true });
  const webp = await normalized.clone().webp({ quality: 84 }).toBuffer();
  const avif = await normalized.clone().avif({ quality: 55, effort: 5 }).toBuffer();
  await Promise.all([
    writeFile(resolve(outputDir, `${item.id}.webp`), webp),
    writeFile(resolve(outputDir, `${item.id}.avif`), avif),
  ]);
  manifestFiles.push({
    id: item.id,
    sourceTitle: loose.title,
    sourceUrl: loose.info.url,
    license: licenseText,
    author: loose.info.extmetadata?.Artist?.value ?? 'Pamela Colman Smith',
    sha256: createHash('sha256').update(webp).digest('hex'),
    sourceWidth: loose.info.width,
    sourceHeight: loose.info.height,
  });
  console.log(`Fetched ${item.id}`);
}

await writeFile(
  resolve(manifestDir, 'provenance.json'),
  `${JSON.stringify({ acquiredAt: new Date().toISOString(), source: 'Wikimedia Commons', files: manifestFiles }, null, 2)}\n`,
);
console.log(`Saved ${manifestFiles.length} verified public-domain assets.`);
