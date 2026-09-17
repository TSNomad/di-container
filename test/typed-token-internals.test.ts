/**
 * Unit tests for the internals invented while implementing typed
 * tokens: the string key normalization shared by all four methods, and
 * the claim-before-act pending cache used for singleton resolution.
 *
 * These are scaffolding per the implementation phase contract, not the
 * acceptance criterion. They exist to prove behavior the acceptance
 * tests do not exercise directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';

test('a token bound as a string can be checked and resolved through a typed token of the same name', async () => {
  const container = new Container();

  container.bind('Cache', () => 'memory-backed');

  const typedToken = createToken<string>('Cache');
  assert.equal(container.has(typedToken), true);
  assert.equal(await container.get(typedToken), 'memory-backed');
});

test('a token bound as a typed token can be checked and resolved through a plain string of the same name', async () => {
  const container = new Container();
  const typedToken = createToken<number>('Retries');

  container.bind(typedToken, () => 3);

  assert.equal(container.has('Retries'), true);
  assert.equal(await container.get<number>('Retries'), 3);
});

test('a rejected singleton factory clears its pending cache so a later get retries the factory', async () => {
  const container = new Container();
  const token = createToken<string>('Flaky');
  let attempts = 0;

  container.bind(
    token,
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary failure');
      }
      return 'recovered';
    },
    true
  );

  await assert.rejects(() => container.get(token), /temporary failure/);
  assert.equal(await container.get(token), 'recovered');
  assert.equal(attempts, 2);
});

test('a stale singleton resolution does not overwrite a rebind that lands while it is in flight', async () => {
  const container = new Container();
  const token = createToken<{ id: number }>('Widget');
  let resolveFirst!: (value: { id: number }) => void;
  const firstFactoryResult = new Promise<{ id: number }>((resolve) => {
    resolveFirst = resolve;
  });

  container.bind(token, () => firstFactoryResult, true);

  const pendingGet = container.get(token);

  container.rebind(token, () => ({ id: 2 }), true);
  resolveFirst({ id: 1 });

  const first = await pendingGet;
  assert.equal(first.id, 1);

  const second = await container.get(token);
  assert.equal(second.id, 2);
});
