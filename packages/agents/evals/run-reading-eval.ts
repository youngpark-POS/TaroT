import { readingResultSchema } from '@tarot/contracts';
import { OpenAIReadingAgent } from '../src/index.js';
import { readingEvalCases } from './reading-cases.js';

if (!process.env.OPENAI_API_KEY)
  throw new Error('OPENAI_API_KEY is required for the live evaluation.');

const agent = new OpenAIReadingAgent(process.env.READING_MODEL ?? 'gpt-5.6-terra');
let structurallyValid = 0;

for (const testCase of readingEvalCases) {
  const result = readingResultSchema.parse(await agent.interpret(testCase));
  const grounded = result.cards.every((item, index) => {
    const expected = testCase.cards[index];
    return (
      expected &&
      item.positionIndex === expected.positionIndex &&
      item.cardId === expected.card.id &&
      item.orientation === expected.orientation
    );
  });
  if (grounded && result.cards.length === testCase.cards.length) structurallyValid += 1;
  console.log(JSON.stringify({ id: testCase.id, input: testCase, result, grounded }));
}

const validRate = structurallyValid / readingEvalCases.length;
console.error(JSON.stringify({ event: 'reading_eval_complete', cases: 30, validRate }));
if (validRate !== 1) process.exitCode = 1;
