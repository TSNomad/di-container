/**
 * Acceptance test: binding a typed token twice throws
 * DuplicateBindingError naming the token. Not implemented yet, see
 * the typed tokens architecture note.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';
import { DuplicateBindingError } from '../dist/errors.js';

test('binding a typed token twice throws a DuplicateBindingError naming the token', () => {
  const portToken = createToken<number>('Port');
  const container = new Container();

  container.bind(portToken, () => 3000);

  assert.throws(
    () => container.bind(portToken, () => 4000),
    (error: unknown) =>
      error instanceof DuplicateBindingError && error.message.includes('Port')
  );
});

test('binding a typed token after a string token with the same name throws a DuplicateBindingError naming the token', () => {
  const container = new Container();

  container.bind('Port', () => 3000);

  assert.throws(
    () => container.bind(createToken<number>('Port'), () => 4000),
    (error: unknown) =>
      error instanceof DuplicateBindingError && error.message.includes('Port')
  );
});

test('binding a string token after a typed token with the same name throws a DuplicateBindingError naming the token', () => {
  const container = new Container();

  container.bind(createToken<number>('Port'), () => 3000);

  assert.throws(
    () => container.bind('Port', () => 4000),
    (error: unknown) =>
      error instanceof DuplicateBindingError && error.message.includes('Port')
  );
});
