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
import { AutowireError, BindingNotFoundError, CircularDependencyError, DiException } from '../dist/errors.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Base {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

test('a subclass whose own constructor takes no parameters, under a parent whose constructor does, needs an inject list', async () => {
  class Fixed extends Base {
    constructor() {
      super('fixed');
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Fixed),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Fixed' && error.reason === 'no-inject'
  );
});

test('an empty inject list of its own lets that subclass build with the arguments its constructor supplies', async () => {
  class Fixed extends Base {
    static readonly inject = [] as const;
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

test('an undefined inject entry, as a circular import leaves one, fails naming the class, with a DiException as cause', async () => {
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
      error.cause instanceof DiException
  );
});

test('a provider get with a value that is no abstract rejects instead of throwing', async () => {
  const container = new Container();
  container.bindFactory('Probe', (provider) => {
    const pending = provider.get(undefined as never);
    return pending.then(
      () => 'resolved',
      (error: unknown) => (error instanceof DiException ? 'rejected' : 'other')
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

test('the 0.1 bind and rebind read an explicit undefined singleton flag as the default, a singleton', async () => {
  const container = new Container();
  let bindRuns = 0;
  let rebindRuns = 0;
  const flag: boolean | undefined = undefined;
  container.bind('Bound', () => ({ run: ++bindRuns }), flag);
  container.rebind('Rebound', () => ({ run: ++rebindRuns }), flag);

  const boundFirst = await container.get('Bound');
  const boundSecond = await container.get('Bound');
  const reboundFirst = await container.get('Rebound');
  const reboundSecond = await container.get('Rebound');

  assert.equal(boundSecond, boundFirst, 'bind(token, factory, undefined) built a second instance');
  assert.equal(bindRuns, 1);
  assert.equal(reboundSecond, reboundFirst, 'rebind(token, factory, undefined) built a second instance');
  assert.equal(rebindRuns, 1);
});

test('the 0.1 bind with an explicit false still builds a new instance on every get', async () => {
  const container = new Container();
  let runs = 0;
  container.bind('Fresh', () => ({ run: ++runs }), false);

  assert.notEqual(await container.get('Fresh'), await container.get('Fresh'));
  assert.equal(runs, 2);
});

test('a comment that mentions constructor( does not hide an inherited constructor', async () => {
  class Commented extends Base {
    // Uses the parent constructor(value) as is.
    describe(): string {
      /* no constructor( of its own */
      return 'commented';
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Commented),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Commented' && error.reason === 'no-inject'
  );
});

test('a string or template literal that mentions constructor( does not hide an inherited constructor', async () => {
  class Quoted extends Base {
    single(): string {
      return 'constructor(';
    }
    double(): string {
      return "constructor (x)";
    }
    template(): string {
      return `constructor(${String(this.value)})`;
    }
  }
  const container = new Container();

  await assert.rejects(
    () => container.get(Quoted),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Quoted' && error.reason === 'no-inject'
  );
});


/**
 * Builds a class from JavaScript source, as a compiler or minifier
 * would emit it, with `Base` in scope.
 */
function emitted(source: string): new () => Base {
  return new Function('Base', `return ${source};`)(Base) as new () => Base;
}

test('a class compiled for an older target, with its fields moved into a forwarding constructor, still needs an inject list', async () => {
  // What tsc and esbuild write for `class Lowered extends Base { extra = 1; }`
  // below ES2022 or with useDefineForClassFields off.
  const Lowered = emitted('class Lowered extends Base { constructor() { super(...arguments); this.extra = 1; } }');
  const container = new Container();

  await assert.rejects(
    () => container.get(Lowered),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Lowered' && error.reason === 'no-inject'
  );
});

test('the same class after a minifier joins its constructor statements still needs an inject list', async () => {
  const Minified = emitted('class Minified extends Base{constructor(){super(...arguments),this.extra=1}}');
  const container = new Container();

  await assert.rejects(
    () => container.get(Minified),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Minified' && error.reason === 'no-inject'
  );
});

test('a function-style subclass with no parameters, as ES5 output writes it, still needs an inject list', async () => {
  const Old = new Function(
    'Base',
    'function Old() { return Reflect.construct(Base, arguments, Old); } Object.setPrototypeOf(Old, Base); Object.setPrototypeOf(Old.prototype, Base.prototype); return Old;'
  )(Base) as new () => Base;
  const container = new Container();

  await assert.rejects(
    () => container.get(Old),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Old' && error.reason === 'no-inject'
  );
});

test('an inject list a class declares itself is checked against its own constructor', async () => {
  const Own = emitted('class Own extends Base { static inject = []; constructor(value) { super(value); } }');
  const container = new Container();

  await assert.rejects(
    () => container.get(Own),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Own' && error.reason === 'short-inject'
  );
});

test('an inherited inject list is checked against the first constructor in the chain that takes parameters', async () => {
  const container = new Container();
  container.bindFactory('Dep', () => 'dep');
  const Pair = new Function(
    'return class Pair { static inject = ["Dep"]; constructor(a, b) { this.a = a; this.b = b; } };'
  )() as new () => object;
  const Child = new Function('Pair', 'return class Child extends Pair {};')(Pair) as new () => object;

  await assert.rejects(
    () => container.get(Child),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Child' && error.reason === 'short-inject'
  );
});

test('a non-empty inject list of its own on a subclass with no constructor is held to the parent constructor', async () => {
  const container = new Container();
  container.bindFactory('A', () => 'a');
  const Pair = new Function('return class Pair { static inject = ["A", "A"]; constructor(a, b) { this.a = a; this.b = b; } };')() as new () => object;
  const Short = new Function('Pair', 'return class Short extends Pair { static inject = ["A"]; };')(Pair) as new () => object;

  await assert.rejects(
    () => container.get(Short),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Short' && error.reason === 'short-inject'
  );
});

test('an own inject field with no value, or null, counts as no list', async () => {
  const container = new Container();
  const Unset = emitted('class Unset extends Base { static inject; }');
  const Nulled = emitted('class Nulled extends Base { static inject = null; }');

  await assert.rejects(
    () => container.get(Unset),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Unset' && error.reason === 'no-inject'
  );
  await assert.rejects(
    () => container.get(Nulled),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Nulled' && error.reason === 'no-inject'
  );
});

test('a subclass that inherits an empty inject list builds as the class that declared it does', async () => {
  class Fixed extends Base {
    static readonly inject = [] as const;
    constructor() {
      super('fixed');
    }
  }
  class Leaf extends Fixed {}
  const container = new Container();

  const leaf = await container.get(Leaf);

  assert.ok(leaf instanceof Leaf);
  assert.equal(leaf.value, 'fixed');
});
