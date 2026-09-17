/**
 * Acceptance test: a string token still works, unchanged, once typed
 * tokens exist. Marked skip along with the rest of this packet's
 * acceptance tests, per the architecture phase contract, even though
 * the string path itself needs no further implementation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';

test('a string token still works', async () => {
  const container = new Container();

  container.bind('Greeting', () => 'hello');

  const value = await container.get<string>('Greeting');

  assert.equal(value, 'hello');
});
