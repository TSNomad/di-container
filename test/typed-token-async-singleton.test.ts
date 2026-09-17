/**
 * Acceptance test: async factories and singleton caching hold for
 * typed tokens the same way they already do for string tokens. Not
 * implemented yet, see docs/architecture/typed-tokens.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';

interface Connection {
  id: number;
}

test.skip('async factories and singleton caching hold for typed tokens', async () => {
  const connectionToken = createToken<Connection>('Connection');
  const container = new Container();
  let calls = 0;

  container.bind(
    connectionToken,
    async () => {
      calls += 1;
      return { id: calls };
    },
    true
  );

  const first = await container.get(connectionToken);
  const second = await container.get(connectionToken);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first.id, 1);
});
