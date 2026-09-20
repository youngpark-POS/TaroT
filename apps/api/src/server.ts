import { buildApp } from './app.js';
import { loadConfig } from '@tarot/runtime';

const config = loadConfig();
let app: Awaited<ReturnType<typeof buildApp>> | undefined;

const shutdown = async () => {
  await app?.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function main() {
  app = await buildApp({ config });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch(async (error) => {
  console.error(error);
  await app?.close();
  process.exit(1);
});
