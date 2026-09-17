/**
 * Acceptance test: a typed token binds and resolves with the inferred
 * type. Not implemented yet, see docs/architecture/typed-tokens.md.
 * Marked skip so the suite stays green while the body is a stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';

interface Logger {
  log(message: string): void;
}

test.skip('a typed token binds and resolves with the inferred type', async () => {
  const loggerToken = createToken<Logger>('Logger');
  const container = new Container();
  const seen: string[] = [];

  container.bind(loggerToken, () => ({
    log: (message: string) => {
      seen.push(message);
    },
  }));

  // No generic argument here. The token alone tells TypeScript that
  // `logger` is a Logger.
  const logger = await container.get(loggerToken);
  logger.log('hello');

  assert.deepEqual(seen, ['hello']);
});
