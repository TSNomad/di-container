/**
 * Unit tests for three error shapes the slice 6 review left open: a value
 * that is no abstract, a dependency that failed with something other
 * than an Error, and a class `bind` with no abstracts.
 *
 * These are scaffolding per the implementation phase contract, not the
 * acceptance criterion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { AutowireError, DiException } from '../dist/errors.js';

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

test('a dependency that fails with a string carries the string into the message and the cause', async () => {
  class Signup {
    static readonly inject = ['Mailer'];
    readonly mailer: unknown;
    constructor(mailer: unknown) {
      this.mailer = mailer;
    }
  }
  const container = new Container();
  container.bindFactory('Mailer', () => {
    throw 'smtp down';
  });

  await assert.rejects(
    () => container.get(Signup),
    (error: unknown) =>
      error instanceof AutowireError &&
      error.reason === 'dependency' &&
      error.message === 'Could not resolve Mailer for Signup: smtp down' &&
      error.cause === 'smtp down'
  );
});

test('a dependency message names a cause that is neither an Error nor a string', () => {
  const number = new AutowireError('Clock', 'dependency', 'Missing', { cause: 42 });
  assert.equal(number.message, 'Could not resolve Missing for Clock: 42');
  assert.equal(number.cause, 42);

  const none = new AutowireError('Clock', 'dependency', 'Missing', { cause: undefined });
  assert.equal(none.message, 'Could not resolve Missing for Clock: undefined');
  assert.equal(Object.hasOwn(none, 'cause'), true);

  // String() throws on an object with no prototype, so the message falls
  // back to the object's tag instead of throwing from the constructor.
  const bare = Object.create(null) as object;
  const opaque = new AutowireError('Clock', 'dependency', 'Missing', { cause: bare });
  assert.equal(opaque.message, 'Could not resolve Missing for Clock: [object Object]');
  assert.equal(opaque.cause, bare);
});

test('bind with a concrete and no abstract throws a DiException and binds nothing', () => {
  class Impl {}
  const container = new Container();

  assert.throws(
    () => (container.bind as (concrete: unknown) => unknown)(Impl),
    (error: unknown) =>
      error instanceof DiException &&
      error.message === 'bind(Impl) needs at least one abstract to bind Impl to.'
  );
  assert.deepEqual(container.getTokens(), []);
  assert.equal(container.has(Impl), false);
});
