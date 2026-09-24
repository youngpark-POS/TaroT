import { MockSpreadAgent, createAgentGateways, createFallbackResult } from '@tarot/agents';
import type { Orientation, Spread, SpreadAgentOutput, TarotCard } from '@tarot/contracts';
import type { AgentJobMessage, StoredReading, TarotRepositoryPort } from '@tarot/database';
import { decrypt, encrypt, type AppConfig } from '@tarot/runtime';

function assertValidRecommendations(output: SpreadAgentOutput, spreads: Spread[]) {
  const ids = new Set(spreads.map((spread) => spread.id));
  if (output.clarificationQuestion) return;
  if (
    output.recommendations.length !== 3 ||
    output.recommendations.some((item) => !ids.has(item.spreadId))
  ) {
    throw new Error('Agent returned invalid spread recommendations.');
  }
}

async function interpretationInput(
  repository: TarotRepositoryPort,
  config: AppConfig,
  reading: StoredReading,
) {
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
    question: clarification ? `${question}\n보충 설명: ${clarification}` : question,
    spread,
    cards,
    highRisk: reading.state.highRisk,
    crisis: reading.state.crisis,
  };
}

export function createAgentJobProcessor(config: AppConfig, repository: TarotRepositoryPort) {
  const { spreadAgent, readingAgent } = createAgentGateways({
    mode: config.AI_MODE,
    spreadModel: config.SPREAD_MODEL,
    readingModel: config.READING_MODEL,
    apiKey: config.OPENAI_API_KEY,
  });

  return {
    async process(message: AgentJobMessage) {
      const reading = await repository.getReading(message.readingId);
      if (!reading) return;

      if (message.type === 'recommend_spread') {
        if (
          reading.status !== 'recommending' ||
          (reading.state.recommendationJobVersion ?? 0) !== message.version
        ) {
          return;
        }
        if (!(await repository.claimAgentJob(message.type, reading.id, message.version))) return;
        const question = decrypt<string>(reading.questionEncrypted, config.DATA_ENCRYPTION_KEY);
        const clarification = reading.clarificationEncrypted
          ? decrypt<string>(reading.clarificationEncrypted, config.DATA_ENCRYPTION_KEY)
          : undefined;
        const spreads = await repository.listSpreads();
        const output = await spreadAgent.recommend({
          question,
          ...(clarification ? { clarification } : {}),
          clarificationAllowed: !reading.state.clarificationUsed,
          spreads,
        });
        assertValidRecommendations(output, spreads);
        await repository.saveSpreadRecommendation(reading.id, message.version, output);
        await repository.completeAgentJob(message.type, reading.id, message.version);
        return;
      }

      if ((reading.state.interpretationJobVersion ?? 0) !== message.version) return;
      if (reading.state.interpretationStatus === 'completed') return;
      if (!(await repository.claimAgentJob(message.type, reading.id, message.version))) return;
      const input = await interpretationInput(repository, config, reading);
      const result = await readingAgent.interpret(input);
      await repository.savePreparedInterpretation(
        reading.id,
        encrypt(result, config.DATA_ENCRYPTION_KEY),
        message.version,
      );
      await repository.completeAgentJob(message.type, reading.id, message.version);
    },

    async fallback(message: AgentJobMessage) {
      const reading = await repository.getReading(message.readingId);
      if (!reading) return;
      if (message.type === 'recommend_spread') {
        const question = decrypt<string>(reading.questionEncrypted, config.DATA_ENCRYPTION_KEY);
        const clarification = reading.clarificationEncrypted
          ? decrypt<string>(reading.clarificationEncrypted, config.DATA_ENCRYPTION_KEY)
          : '';
        const spreads = await repository.listSpreads();
        const output = await new MockSpreadAgent().recommend({
          question: clarification ? `${question} ${clarification}` : question,
          clarificationAllowed: false,
          spreads,
        });
        await repository.saveSpreadRecommendation(reading.id, message.version, output);
        await repository.completeAgentJob(message.type, reading.id, message.version);
        return;
      }

      const input = await interpretationInput(repository, config, reading);
      const result = createFallbackResult(input);
      await repository.savePreparedInterpretation(
        reading.id,
        encrypt(result, config.DATA_ENCRYPTION_KEY),
        message.version,
      );
      await repository.completeAgentJob(message.type, reading.id, message.version);
    },
  };
}
