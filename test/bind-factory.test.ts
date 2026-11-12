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
import { CircularDependencyError, DuplicateBindingError } from '../dist/errors.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

test.skip('the factory receives a provider that resolves other bindings from the container', async () => {
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

test.skip('concurrent gets of a rejecting factory run it once, all reject with that error, and a later get runs it again', async () => {
  const container = new Container();
  let calls = 0;
  const failure = new Error('connect refused');
  container.bindFactory(Connection, async () => {
    calls += 1;
    await tick(5);
    if (calls === 1) {
      throw failure;
    }
    return { id: calls };
  });

  const results = await Promise.allSettled([container.get(Connection), container.get(Connection)]);

  assert.equal(calls, 1, 'the waiters shared one run');
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal((result as PromiseRejectedResult).reason, failure);
  }
  assert.equal((await container.get(Connection)).id, 2);
});

test.skip('the class form of bind and bindFactory collide on the same abstract, in either order', () => {
  class FileSettings extends Settings {
    value(): string {
      return 'file';
    }
  }
  const first = new Container();
  first.bind(FileSettings, Settings);
  assert.throws(
    () => first.bindFactory(Settings, () => new FileSettings()),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Settings'
  );

  const second = new Container();
  second.bindFactory(Settings, () => new FileSettings());
  assert.throws(
    () => second.bind(FileSettings, Settings),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Settings'
  );
});

test.skip('a factory that gets its own abstract through its provider fails with CircularDependencyError', { timeout: 2000 }, async () => {
  const container = new Container();
  container.bindFactory(Connection, async (c) => {
    await tick(1);
    return c.get(Connection);
  });

  await assert.rejects(
    () => container.get(Connection),
    (error: unknown) => error instanceof CircularDependencyError && error.path.join(' -> ') === 'Connection -> Connection'
  );
});

test.skip('a loop through a factory and an inject list fails with CircularDependencyError', { timeout: 2000 }, async () => {
  interface Repo {
    service: unknown;
  }
  const Repo = createToken<Repo>('Repo');
  class Service {
    static readonly inject = [Repo] as const;
    readonly repo: Repo;
    constructor(repo: Repo) {
      this.repo = repo;
    }
  }
  const container = new Container();
  container.bindFactory(Repo, async (c) => ({ service: await c.get(Service) }));

  await assert.rejects(
    () => container.get(Repo),
    (error: unknown) =>
      error instanceof CircularDependencyError && error.path.includes('Repo') && error.path.includes('Service')
  );
});

test.skip('concurrent gets that enter a factory loop at different abstracts both fail instead of waiting forever', { timeout: 2000 }, async () => {
  interface Ping {
    pong: unknown;
  }
  interface Pong {
    ping: unknown;
  }
  const Ping = createToken<Ping>('Ping');
  const Pong = createToken<Pong>('Pong');
  const container = new Container();
  container.bindFactory(Ping, async (c) => {
    await tick(5);
    return { pong: await c.get(Pong) };
  });
  container.bindFactory(Pong, async (c) => {
    await tick(5);
    return { ping: await c.get(Ping) };
  });

  const results = await Promise.allSettled([container.get(Ping), container.get(Pong)]);

  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.ok((result as PromiseRejectedResult).reason instanceof CircularDependencyError);
  }
});
