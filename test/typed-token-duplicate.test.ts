/**
 * Acceptance test: binding a typed token twice throws
 * DuplicateBindingError naming the token. Not implemented yet, see
 * docs/architecture/typed-tokens.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';
import { DuplicateBindingError } from '../dist/errors.js';

test.skip('binding a typed token twice throws a DuplicateBindingError naming the token', () => {
  const portToken = createToken<number>('Port');
  const container = new Container();

  container.bind(portToken, () => 3000);

  assert.throws(
    () => container.bind(portToken, () => 4000),
    (error: unknown) =>
      error instanceof DuplicateBindingError && error.message.includes('Port')
  );
});
