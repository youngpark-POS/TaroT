import awsLambdaFastify from '@fastify/aws-lambda';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { loadLambdaConfig } from '@tarot/runtime';
import { buildApp } from './app.js';

async function initialize() {
  const config = await loadLambdaConfig();
  const app = await buildApp({ config });
  await app.ready();
  return awsLambdaFastify(app, { decorateRequest: false });
}

let proxyPromise: ReturnType<typeof initialize> | undefined;

export async function handler(event: APIGatewayProxyEventV2, context: Context) {
  proxyPromise ??= initialize();
  const proxy = await proxyPromise;
  return proxy(event, context);
}
