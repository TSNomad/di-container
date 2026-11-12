/**
 * Unit tests for the container internals the slice 6 acceptance tests
 * leave to the implementer: how it counts constructor parameters, how it
 * names class keys, the wait graph behind the loop check, and the
 * bindings that are not singletons.
 *
 * These are scaffolding per the implementation phase contract, not the
 * acceptance criterion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { AutowireError, BindingNotFoundError, CircularDependencyError } from '../dist/errors.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Base {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

test('a subclass with its own constructor and no parameters needs no inject list, even when its parent takes one', async () => {
  class Fixed extends Base {
    constructor() {
      super('fixed');
    }
  }
  const container = new Container();

  const fixed = await container.get(Fixed);

  assert.ok(fixed instanceof Fixed);
  assert.equal(fixed.value, 'fixed');
});

test('a class two levels below a constructor with parameters reports those parameters', async () => {
  class Middle extends Base {}
  class Leaf extends Middle {}
  const container = new Container();

  await assert.rejects(
    () => container.get(Leaf),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Leaf' && error.reason === 'no-inject'
  );
});

test('a method whose name ends in constructor is not read as a constructor', async () => {
  class Teardown extends Base {
    deconstructor(): void {}
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Teardown),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Teardown' && error.reason === 'no-inject'
  );
});

test('a call through a constructor property is not read as a constructor', async () => {
  class Copier extends Base {
    copy(): unknown {
      const self: any = this;
      return self.constructor();
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Copier),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Copier' && error.reason === 'no-inject'
  );
});

test('an undefined inject entry, as a circular import leaves one, fails naming the class, with a TypeError as cause', async () => {
  class Importer {
    static readonly inject = [undefined];
    constructor(_missing?: unknown) {}
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Importer),
    (error: unknown) =>
      error instanceof AutowireError &&
      error.concrete === 'Importer' &&
      error.reason === 'dependency' &&
      error.dependency === 'undefined' &&
      error.cause instanceof TypeError
  );
});

test('a provider get with a value that is no abstract rejects instead of throwing', async () => {
  const container = new Container();
  container.bindFactory('Probe', (provider) => {
    const pending = provider.get(undefined as never);
    return pending.then(
      () => 'resolved',
      (error: unknown) => (error instanceof TypeError ? 'rejected' : 'other')
    );
  });

  assert.equal(await container.get<string>('Probe'), 'rejected');
});

test('getTokens and BindingNotFoundError name a class abstract by its class name', async () => {
  abstract class Store {}
  class MemoryStore extends Store {}
  const container = new Container();
  container.bind(MemoryStore, Store);
  container.bind('Config', () => ({}));

  assert.deepEqual(container.getTokens(), ['Store', 'Config']);
  await assert.rejects(
    () => container.get('Missing'),
    (error: unknown) =>
      error instanceof BindingNotFoundError && error.availableTokens.join(',') === 'Store,Config'
  );
});

test('a 0.1 binding that is not a singleton runs its factory on every get', async () => {
  const container = new Container();
  let calls = 0;
  container.bind(
    'Fresh',
    () => {
      calls += 1;
      return { call: calls };
    },
    false
  );

  const [first, second] = await Promise.all([container.get('Fresh'), container.get('Fresh')]);
  const third = await container.get('Fresh');

  assert.equal(calls, 3);
  assert.notEqual(first, second);
  assert.notEqual(second, third);
});

test('a token rebind that is not a singleton runs on every get', async () => {
  const container = new Container();
  let calls = 0;
  container.rebind(
    'Fresh',
    () => {
      calls += 1;
      return { call: calls };
    },
    false
  );

  const [first, second] = await Promise.all([container.get('Fresh'), container.get('Fresh')]);

  assert.equal(calls, 2);
  assert.notEqual(first, second);
});

test('a loop through a token rebind that is not a singleton rejects with CircularDependencyError', { timeout: 2000 }, async () => {
  const container = new Container();
  let depth = 0;
  container.rebind(
    'Echo',
    async (provider) => {
      depth += 1;
      if (depth > 20) {
        return 'bottomed out';
      }
      await tick(0);
      return provider.get('Echo');
    },
    false
  );

  await assert.rejects(
    () => container.get('Echo'),
    (error: unknown) => error instanceof CircularDependencyError && error.path.join(' -> ') === 'Echo -> Echo'
  );
  assert.equal(depth, 1, 'the loop was refused at its first turn');
});

test('a loop of three classes is found through two waits, before any constructor runs', { timeout: 2000 }, async () => {
  let built = 0;
  class Alpha {
    static inject: readonly unknown[] = [];
    constructor(_next: unknown) {
      built += 1;
    }
  }
  class Beta {
    static inject: readonly unknown[] = [];
    constructor(_next: unknown) {
      built += 1;
    }
  }
  class Gamma {
    static inject: readonly unknown[] = [];
    constructor(_next: unknown) {
      built += 1;
    }
  }
  Alpha.inject = [Beta];
  Beta.inject = [Gamma];
  Gamma.inject = [Alpha];
  const container = new Container();

  await assert.rejects(
    () => container.get(Alpha),
    (error: unknown) =>
      error instanceof CircularDependencyError && error.path.join(' -> ') === 'Alpha -> Beta -> Gamma -> Alpha'
  );
  assert.equal(built, 0);
});

test('a wait that has ended does not count toward a loop', { timeout: 2000 }, async () => {
  let openSlow: () => void = () => {};
  const slowGate = new Promise<void>((resolve) => {
    openSlow = resolve;
  });
  let openOther: () => void = () => {};
  const otherGate = new Promise<void>((resolve) => {
    openOther = resolve;
  });
  const container = new Container();
  let slowRun: Promise<unknown> = Promise.resolve();

  // Top waits on Quick, which returns at once and leaves a get of Slow
  // running. Top then waits on Other. Slow later asks for Top. Nothing
  // waits on Slow, so that is no loop, as long as Top's finished wait on
  // Quick no longer counts.
  container.bindFactory('Top', async (provider) => {
    await provider.get('Quick');
    await provider.get('Other');
    return 'top';
  });
  container.bindFactory('Quick', (provider) => {
    slowRun = provider.get('Slow');
    slowRun.catch(() => {});
    return 'quick';
  });
  container.bindFactory('Other', async () => {
    await otherGate;
    return 'other';
  });
  container.bindFactory('Slow', async (provider) => {
    await slowGate;
    return `slow saw ${await provider.get<string>('Top')}`;
  });

  const top = container.get<string>('Top');
  await tick(5);
  openSlow();
  await tick(5);
  openOther();

  assert.equal(await top, 'top');
  assert.equal(await slowRun, 'slow saw top', 'the run Quick started was not refused as a loop');
});
