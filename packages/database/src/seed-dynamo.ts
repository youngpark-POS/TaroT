import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { CONTENT_VERSION, cards, spreads } from '@tarot/content';

const tableName = process.env.CONTENT_TABLE;
if (!tableName) throw new Error('CONTENT_TABLE is required.');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const existing = await client.send(
  new GetCommand({
    TableName: tableName,
    Key: { contentVersion: CONTENT_VERSION, entityKey: 'META' },
  }),
);

if (existing.Item) {
  console.log(JSON.stringify({ event: 'content_already_seeded', version: CONTENT_VERSION }));
  process.exit(0);
}

type NativeWriteRequest = { PutRequest: { Item: Record<string, unknown> } };

const requests: NativeWriteRequest[] = [
  ...cards.map((card) => ({
    PutRequest: {
      Item: { contentVersion: CONTENT_VERSION, entityKey: `CARD#${card.id}`, data: card },
    },
  })),
  ...spreads.map((spread) => ({
    PutRequest: {
      Item: { contentVersion: CONTENT_VERSION, entityKey: `SPREAD#${spread.id}`, data: spread },
    },
  })),
];

while (requests.length > 0) {
  const batch = requests.splice(0, 25);
  let pending = batch;
  for (let attempt = 0; pending.length > 0 && attempt < 6; attempt += 1) {
    const response = await client.send(
      new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
    );
    pending = (response.UnprocessedItems?.[tableName] ?? []) as NativeWriteRequest[];
    if (pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
    }
  }
  if (pending.length > 0) throw new Error('DynamoDB content seed left unprocessed items.');
}

await client.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      contentVersion: CONTENT_VERSION,
      entityKey: 'META',
      cardCount: cards.length,
      spreadCount: spreads.length,
      seededAt: new Date().toISOString(),
    },
  }),
);

console.log(
  JSON.stringify({
    event: 'content_seeded',
    version: CONTENT_VERSION,
    cardCount: cards.length,
    spreadCount: spreads.length,
  }),
);
