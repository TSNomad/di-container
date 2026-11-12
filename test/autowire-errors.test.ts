/**
 * Acceptance tests: the errors autowiring raises. Each one must name
 * the class the container was building, so a wiring mistake can be
 * found from the message alone. See docs/architecture/ncc-slice-6.md.
 *
 * Marked `test.skip` while the container's class path is a stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';
import {
  AutowireError,
  BindingNotFoundError,
  CircularDependencyError,
  DiException,
} from '../dist/errors.js';

interface Mailer {
  send(to: string): void;
}
const Mailer = createToken<Mailer>('Mailer');

class NeedsArgsNoList {
  readonly mailer: unknown;
  constructor(mailer: unknown) {
    this.mailer = mailer;
  }
}

test.skip('a class that needs constructor parameters but has no inject list fails, naming the class', async () => {
  const container = new Container();

  await assert.rejects(
    () => container.get(NeedsArgsNoList),
    (error: unknown) =>
      error instanceof AutowireError &&
      error instanceof DiException &&
      error.concrete === 'NeedsArgsNoList' &&
      error.message.includes('NeedsArgsNoList') &&
      error.message.includes('inject')
  );
});

test.skip('the same check applies to a class reached through bind', async () => {
  const container = new Container();
  // A JavaScript caller, or a cast, can reach bind without the compile-time check.
  container.bind(NeedsArgsNoList as never, Mailer as never);

  await assert.rejects(
    () => container.get(Mailer),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'NeedsArgsNoList'
  );
});

test.skip('an inject list shorter than the constructor fails, naming the class', async () => {
  class ShortList {
    static readonly inject = [Mailer];
    readonly mailer: unknown;
    readonly other: unknown;
    constructor(mailer: unknown, other: unknown) {
      this.mailer = mailer;
      this.other = other;
    }
  }
  const container = new Container();
  container.bindFactory(Mailer, () => ({ send: () => {} }));

  await assert.rejects(
    () => container.get(ShortList),
    (error: unknown) =>
      error instanceof AutowireError && error.concrete === 'ShortList' && error.message.includes('ShortList')
  );
});

test.skip('an unbound inject entry fails naming the class and the entry, with the lookup error as cause', async () => {
  class Signup {
    static readonly inject = [Mailer] as const;
    readonly mailer: Mailer;
    constructor(mailer: Mailer) {
      this.mailer = mailer;
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Signup),
    (error: unknown) =>
      error instanceof AutowireError &&
      error.concrete === 'Signup' &&
      error.dependency === 'Mailer' &&
      error.message.includes('Signup') &&
      error.message.includes('Mailer') &&
      error.cause instanceof BindingNotFoundError
  );
});

test.skip('a failure two levels down is wrapped once per level', async () => {
  class Transport {
    static readonly inject = [Mailer] as const;
    readonly mailer: Mailer;
    constructor(mailer: Mailer) {
      this.mailer = mailer;
    }
  }
  class Newsletter {
    static readonly inject = [Transport] as const;
    readonly transport: Transport;
    constructor(transport: Transport) {
      this.transport = transport;
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Newsletter),
    (error: unknown) => {
      if (!(error instanceof AutowireError)) return false;
      const inner = error.cause;
      return (
        error.concrete === 'Newsletter' &&
        error.dependency === 'Transport' &&
        inner instanceof AutowireError &&
        inner.concrete === 'Transport' &&
        inner.dependency === 'Mailer' &&
        inner.cause instanceof BindingNotFoundError
      );
    }
  );
});

test.skip('a dependency whose constructor throws is wrapped, naming the class that needed it', async () => {
  class Broken {
    constructor() {
      throw new RangeError('cannot build');
    }
  }
  class UsesBroken {
    static readonly inject = [Broken] as const;
    readonly broken: Broken;
    constructor(broken: Broken) {
      this.broken = broken;
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(UsesBroken),
    (error: unknown) =>
      error instanceof AutowireError &&
      error.concrete === 'UsesBroken' &&
      error.dependency === 'Broken' &&
      error.cause instanceof RangeError
  );
});

// Classes that need each other. Declared with `var` hoisting avoided:
// the inject lists are assigned after both classes exist.
class Left {
  static inject: readonly unknown[] = [];
  readonly right: unknown;
  constructor(right: unknown) {
    this.right = right;
  }
}
class Right {
  static inject: readonly unknown[] = [];
  static built = 0;
  readonly left: unknown;
  constructor(left: unknown) {
    Right.built += 1;
    this.left = left;
  }
}
Left.inject = [Right];
Right.inject = [Left];

test.skip('a loop in inject lists fails with the loop as path, before any constructor in it runs', async () => {
  Right.built = 0;
  const container = new Container();

  await assert.rejects(
    () => container.get(Left),
    (error: unknown) =>
      error instanceof CircularDependencyError &&
      error instanceof AutowireError &&
      error.path.join(' -> ') === 'Left -> Right -> Left' &&
      error.message.includes('Left -> Right -> Left')
  );
  assert.equal(Right.built, 0);
});

test.skip('concurrent gets that enter a loop at different classes both fail instead of waiting forever', { timeout: 2000 }, async () => {
  const container = new Container();

  const results = await Promise.allSettled([container.get(Left), container.get(Right)]);

  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');
  assert.ok((results[0] as PromiseRejectedResult).reason instanceof CircularDependencyError);
  assert.ok((results[1] as PromiseRejectedResult).reason instanceof CircularDependencyError);
});

test.skip('a loop that passes through a bound token is found too', async () => {
  interface Repo {
    load(): void;
  }
  const Repo = createToken<Repo>('Repo');
  class Service {
    static readonly inject = [Repo] as const;
    readonly repo: Repo;
    constructor(repo: Repo) {
      this.repo = repo;
    }
  }
  class SqlRepo implements Repo {
    static readonly inject = [Service] as const;
    readonly service: Service;
    constructor(service: Service) {
      this.service = service;
    }
    load(): void {}
  }
  const container = new Container();
  container.bind(SqlRepo, Repo);

  await assert.rejects(
    () => container.get(Service),
    (error: unknown) =>
      error instanceof CircularDependencyError && error.path.join(' -> ') === 'Service -> Repo -> Service'
  );
});

test.skip('an unbound typed token still fails with BindingNotFoundError, a DiException', async () => {
  const container = new Container();

  await assert.rejects(
    () => container.get(Mailer),
    (error: unknown) => error instanceof BindingNotFoundError && error instanceof DiException
  );
});

test.skip('a subclass that inherits a constructor with parameters and declares no inject list fails, naming the subclass', async () => {
  class Base {
    readonly mailer: unknown;
    constructor(mailer: unknown) {
      this.mailer = mailer;
    }
  }
  class Derived extends Base {}
  const container = new Container();

  await assert.rejects(
    () => container.get(Derived),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Derived'
  );
});

test.skip('a dependency that failed once is not cached, so a later get of the class that needs it succeeds', async () => {
  let attempts = 0;
  const container = new Container();
  container.bindFactory(Mailer, () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('mail server down');
    }
    return { send: () => {} };
  });
  class Notifier {
    static readonly inject = [Mailer] as const;
    readonly mailer: Mailer;
    constructor(mailer: Mailer) {
      this.mailer = mailer;
    }
  }

  await assert.rejects(() => container.get(Notifier), AutowireError);
  const notifier = await container.get(Notifier);

  assert.equal(attempts, 2);
  assert.ok(notifier instanceof Notifier);
});
