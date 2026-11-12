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
import type { InstanceProvider } from '../dist/InstanceProvider.js';

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

test('a factory binding resolves to what the factory returns', async () => {
  const container = new Container();
  container.bindFactory(Connection, () => ({ id: 7 }));

  const connection = await container.get(Connection);

  assert.equal(connection.id, 7);
});

test('the factory receives a provider that resolves other bindings from the container', async () => {
  const container = new Container();
  container.bindFactory(Connection, () => ({ id: 1 }));
  container.bindFactory(Pool, async (c) => ({ connection: await c.get(Connection) }));

  const pool = await container.get(Pool);

  assert.equal(pool.connection, await container.get(Connection));
});

test('the factory runs once and its result is shared, even under concurrent gets', async () => {
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

test('a class abstract can be bound to a factory', async () => {
  const container = new Container();
  container.bindFactory(Settings, () => ({ value: () => 'from factory' }));

  const settings = await container.get(Settings);

  assert.equal(settings.value(), 'from factory');
  assert.equal(container.has(Settings), true);
});

test('a rejected factory leaves nothing cached, so a later get runs it again', async () => {
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

test('bindFactory returns the container so calls chain', () => {
  const container = new Container();

  assert.equal(container.bindFactory(Connection, () => ({ id: 1 })), container);
});

test('bindFactory on an abstract that is already bound throws DuplicateBindingError', () => {
  const container = new Container();
  container.bindFactory(Connection, () => ({ id: 1 }));

  assert.throws(
    () => container.bindFactory(Connection, () => ({ id: 2 })),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Connection' && error.reason === 'bound'
  );
  assert.throws(
    () => container.bind('Connection', () => ({ id: 3 })),
    (error: unknown) => error instanceof DuplicateBindingError,
    'a 0.1 bind under the same name collides as well'
  );

  const legacyFirst = new Container();
  legacyFirst.bind(Pool, () => ({ connection: { id: 1 } }));
  assert.throws(
    () => legacyFirst.bindFactory(Pool, () => ({ connection: { id: 2 } })),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Pool' && error.reason === 'bound',
    'bindFactory after a 0.1 bind of the same token collides'
  );
});

test('concurrent gets of a rejecting factory run it once, all reject with that error, and a later get runs it again', async () => {
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

test('the class form of bind and bindFactory collide on the same abstract, in either order', () => {
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

test('a factory that gets its own abstract through its provider fails with CircularDependencyError', { timeout: 2000 }, async () => {
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

test('a loop through a factory and an inject list fails with CircularDependencyError', { timeout: 2000 }, async () => {
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

test('concurrent gets that enter a factory loop at different abstracts both fail instead of waiting forever', { timeout: 2000 }, async () => {
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

test('concurrent factories that share a dependency with no loop both resolve, and it is built once', { timeout: 2000 }, async () => {
  interface Left {
    pool: Pool;
  }
  interface Right {
    pool: Pool;
  }
  const Left = createToken<Left>('Left');
  const Right = createToken<Right>('Right');
  let pools = 0;
  const container = new Container();
  container.bindFactory(Pool, async () => {
    pools += 1;
    await tick(10);
    return { connection: { id: pools } };
  });
  container.bindFactory(Left, async (c) => ({ pool: await c.get(Pool) }));
  container.bindFactory(Right, async (c) => {
    await tick(2);
    return { pool: await c.get(Pool) };
  });

  const [left, right] = await Promise.all([container.get(Left), container.get(Right)]);

  assert.equal(pools, 1, 'the shared dependency was built once');
  assert.equal(left.pool, right.pool);
});

test('a provider kept by a factory resolves as a top-level get once the factory has settled', { timeout: 2000 }, async () => {
  interface Lazy {
    provider: InstanceProvider;
  }
  const Lazy = createToken<Lazy>('Lazy');
  class NeedsLazy {
    static readonly inject = [Lazy] as const;
    readonly lazy: Lazy;
    constructor(lazy: Lazy) {
      this.lazy = lazy;
    }
  }
  const container = new Container();
  container.bindFactory(Lazy, (c) => ({ provider: c }));

  const lazy = await container.get(Lazy);

  assert.equal(await lazy.provider.get(Lazy), lazy, 'a later get of its own abstract returns the cached instance');
  const needs = await lazy.provider.get(NeedsLazy);
  assert.equal(needs.lazy, lazy, 'a later get of a class that needs it builds');
});

test('a rebind while a bindFactory run is in flight stays in effect when the run finishes', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const container = new Container();
  container.bindFactory('Pool', async () => {
    await gate;
    return { connection: { id: 1 } };
  });

  const inFlight = container.get<Pool>('Pool');
  container.rebind('Pool', () => ({ connection: { id: 2 } }));
  release();

  assert.equal((await inFlight).connection.id, 1);
  assert.equal((await container.get<Pool>('Pool')).connection.id, 2, 'the rebind stays in effect');
});

test('a token rebind factory receives a provider, as a bindFactory factory does, and a loop through it rejects', { timeout: 2000 }, async () => {
  const container = new Container();
  container.bind('Config', () => ({ region: 'eu' }));
  container.rebind('Region', async (provider: InstanceProvider) => (await provider.get<{ region: string }>('Config')).region);
  assert.equal(await container.get<string>('Region'), 'eu');

  container.rebind('Echo', (provider: InstanceProvider) => provider.get('Echo'));
  await assert.rejects(
    () => container.get('Echo'),
    (error: unknown) => error instanceof CircularDependencyError && error.path.join(' -> ') === 'Echo -> Echo'
  );
});
