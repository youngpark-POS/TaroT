import { spreads } from '@tarot/content';
import { OpenAISpreadAgent } from '../src/index.js';
import { spreadEvalCases } from './spread-cases.js';

if (!process.env.OPENAI_API_KEY)
  throw new Error('OPENAI_API_KEY is required for the live evaluation.');

const agent = new OpenAISpreadAgent(process.env.SPREAD_MODEL ?? 'gpt-5.6-luna');
let top1 = 0;
let top3 = 0;
let validIds = 0;
const catalogIds = new Set(spreads.map((spread) => spread.id));

for (const testCase of spreadEvalCases) {
  const output = await agent.recommend({
    question: testCase.question,
    clarificationAllowed: false,
    spreads,
  });
  const ids = output.recommendations.map((item) => item.spreadId);
  if (ids[0] === testCase.expectedTop1) top1 += 1;
  if (ids.some((id) => testCase.acceptedTop3.includes(id))) top3 += 1;
  if (ids.length === 3 && ids.every((id) => catalogIds.has(id))) validIds += 1;
  console.log(JSON.stringify({ id: testCase.id, expected: testCase.expectedTop1, actual: ids }));
}

const metrics = {
  cases: spreadEvalCases.length,
  top1: top1 / spreadEvalCases.length,
  top3: top3 / spreadEvalCases.length,
  validIds: validIds / spreadEvalCases.length,
};
console.log(JSON.stringify({ event: 'spread_eval_complete', ...metrics }));
if (metrics.top1 < 0.85 || metrics.top3 < 0.95 || metrics.validIds !== 1) process.exitCode = 1;
