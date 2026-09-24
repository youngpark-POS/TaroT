import { createAgentGateways, createFallbackResult } from '@tarot/agents';
import type { Orientation, TarotCard } from '@tarot/contracts';
import { TarotRepository } from '@tarot/database';
import { decrypt, encrypt, loadConfig } from '@tarot/runtime';

const config = loadConfig();
const repository = new TarotRepository(config.DATABASE_URL);
const { readingAgent } = createAgentGateways({
  mode: config.AI_MODE,
  spreadModel: config.SPREAD_MODEL,
  readingModel: config.READING_MODEL,
  apiKey: config.OPENAI_API_KEY,
});
let running = true;
let lastCleanup = 0;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function buildInput(readingId: string) {
  const reading = await repository.getReading(readingId);
  if (!reading) throw new Error('Reading expired before interpretation.');
  if (!reading.state.selectedSpreadId) throw new Error('Reading has no selected spread.');
  const spread = await repository.getSpread(reading.state.selectedSpreadId);
  if (!spread) throw new Error('Selected spread is missing.');
  const cards: Array<{ card: TarotCard; orientation: Orientation; positionIndex: number }> = [];
  for (const draw of reading.state.draw) {
    const card = await repository.getCard(draw.cardId);
    if (!card) throw new Error(`Card ${draw.cardId} is missing.`);
    cards.push({ card, orientation: draw.orientation, positionIndex: draw.positionIndex });
  }
  const question = decrypt<string>(reading.questionEncrypted, config.DATA_ENCRYPTION_KEY);
  const clarification = reading.clarificationEncrypted
    ? decrypt<string>(reading.clarificationEncrypted, config.DATA_ENCRYPTION_KEY)
    : '';
  return {
    reading,
    input: {
      question: clarification ? `${question}\n보충 설명: ${clarification}` : question,
      spread,
      cards,
      highRisk: reading.state.highRisk,
      crisis: reading.state.crisis,
    },
  };
}

async function processOne() {
  const job = await repository.claimJob();
  if (!job) return false;
  try {
    const { reading, input } = await buildInput(job.readingId);
    const result = await readingAgent.interpret(input);
    await repository.savePreparedInterpretation(
      reading.id,
      encrypt(result, config.DATA_ENCRYPTION_KEY),
    );
    await repository.completeJob(job.id);
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    console.error(
      JSON.stringify({
        event: 'interpretation_failed',
        jobId: job.id,
        attempts: job.attempts,
        errorType,
      }),
    );
    if (error instanceof Error && error.name === 'ModelRefusalError') {
      await repository.updateReading(job.readingId, { status: 'failed' });
      await repository.completeJob(job.id);
      return true;
    }
    const failed = await repository.retryOrFailJob(
      job.id,
      'Interpretation attempt failed.',
      job.attempts,
    );
    if (failed) {
      try {
        const { reading, input } = await buildInput(job.readingId);
        const fallback = createFallbackResult(input);
        await repository.savePreparedInterpretation(
          reading.id,
          encrypt(fallback, config.DATA_ENCRYPTION_KEY),
        );
      } catch (fallbackError) {
        console.error(
          JSON.stringify({
            event: 'fallback_failed',
            jobId: job.id,
            errorType: fallbackError instanceof Error ? fallbackError.name : 'UnknownFallbackError',
          }),
        );
      }
    }
  }
  return true;
}

async function main() {
  await repository.isReady();
  await repository.recoverStaleJobs();
  console.log(JSON.stringify({ event: 'worker_started', aiMode: config.AI_MODE }));
  while (running) {
    const processed = await processOne();
    if (Date.now() - lastCleanup > 10 * 60 * 1_000) {
      await repository.recoverStaleJobs();
      await repository.cleanupExpired();
      lastCleanup = Date.now();
    }
    if (!processed) await wait(600);
  }
}

async function shutdown() {
  running = false;
  await repository.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch(async (error) => {
  console.error(error);
  await repository.close();
  process.exit(1);
});
