/**
 * Acceptance tests: `bindFactory(abstract, factory)`, PHPNomad's form.
 * See docs/architecture/ncc-slice-6.md.
 *
 * Marked `test.skip` while `bindFactory` is a stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';
import { DuplicateBindingError } from '../dist/errors.js';

interface Connection {
  id: number;
}
const Connection = createToken<Connection>('Connection');

interface Pool {
  connection: Connection;
}
const Pool = createToken<Pool>('Pool');

abstract class Settings {
  abstract value(): string;
}

test.skip('a factory binding resolves to what the factory returns', async () => {
  const container = new Container();
  container.bindFactory(Connection, () => ({ id: 7 }));

  const connection = await container.get(Connection);

  assert.equal(connection.id, 7);
});

test.skip('the factory receives the container and can resolve other bindings', async () => {
  const container = new Container();
  container.bindFactory(Connection, () => ({ id: 1 }));
  container.bindFactory(Pool, async (c) => ({ connection: await c.get(Connection) }));

  const pool = await container.get(Pool);

  assert.equal(pool.connection, await container.get(Connection));
});

test.skip('the factory runs once and its result is shared, even under concurrent gets', async () => {
  const container = new Container();
  let calls = 0;
  container.bindFactory(Connection, async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { id: calls };
  });

  const [first, second] = await Promise.all([container.get(Connection), container.get(Connection)]);
  const third = await container.get(Connection);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first, third);
});

test.skip('a class abstract can be bound to a factory', async () => {
  const container = new Container();
  container.bindFactory(Settings, () => ({ value: () => 'from factory' }));

  const settings = await container.get(Settings);

  assert.equal(settings.value(), 'from factory');
  assert.equal(container.has(Settings), true);
});

test.skip('a rejected factory leaves nothing cached, so a later get runs it again', async () => {
  const container = new Container();
  let attempts = 0;
  container.bindFactory(Connection, async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('first connect fails');
    }
    return { id: attempts };
  });

  await assert.rejects(() => container.get(Connection), /first connect fails/);
  const connection = await container.get(Connection);

  assert.equal(connection.id, 2);
});

test.skip('bindFactory returns the container so calls chain', () => {
  const container = new Container();

  assert.equal(container.bindFactory(Connection, () => ({ id: 1 })), container);
});

test.skip('bindFactory on an abstract that is already bound throws DuplicateBindingError', () => {
  const container = new Container();
  container.bindFactory(Connection, () => ({ id: 1 }));

  assert.throws(
    () => container.bindFactory(Connection, () => ({ id: 2 })),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Connection'
  );
  assert.throws(
    () => container.bind('Connection', () => ({ id: 3 })),
    (error: unknown) => error instanceof DuplicateBindingError,
    'a 0.1 bind under the same name collides as well'
  );
});
