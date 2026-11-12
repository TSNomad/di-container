/**
 * Unit tests for error shapes the slice 6 review left open: a value
 * that is no abstract.
 *
 * These are scaffolding per the implementation phase contract, not the
 * acceptance criterion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { DiException } from '../dist/errors.js';

const notAnAbstract = (value: string) => `${value} is not a class, a typed token or a string token`;

test('a value that is no abstract throws a DiException from has, bind and bindFactory, keeping the message', () => {
  const container = new Container();
  class Impl {}

  assert.throws(
    () => container.has(42 as never),
    (error: unknown) => error instanceof DiException && error.message === notAnAbstract('42')
  );
  assert.throws(
    () => container.bind(Impl, null as never),
    (error: unknown) => error instanceof DiException && error.message === notAnAbstract('null')
  );
  assert.throws(
    () => container.bindFactory({} as never, () => ({})),
    (error: unknown) => error instanceof DiException && error.message === notAnAbstract('[object Object]')
  );
  // String() throws on an object with no prototype. The message names it
  // by its tag, so the DiException still comes out.
  assert.throws(
    () => container.has(Object.create(null) as never),
    (error: unknown) => error instanceof DiException && error.message === notAnAbstract('[object Object]')
  );
});

test('a get of a value that is no abstract rejects with a DiException, keeping the message', async () => {
  const container = new Container();

  await assert.rejects(
    () => container.get(undefined as never),
    (error: unknown) => error instanceof DiException && error.message === notAnAbstract('undefined')
  );
});
