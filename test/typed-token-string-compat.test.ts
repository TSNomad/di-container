/**
 * Acceptance test: a string token still works, unchanged, once typed
 * tokens exist.
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
