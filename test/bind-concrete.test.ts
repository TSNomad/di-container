/**
 * Acceptance tests: `bind(concrete, abstract, ...abstracts)`, the
 * PHPNomad form. See docs/architecture/ncc-slice-6.md.
 *
 * Marked `test.skip` while the container's class path is a stub. The
 * implementer removes the marker and changes nothing else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';
import { DuplicateBindingError } from '../dist/errors.js';

interface Logger {
  log(message: string): void;
}
const Logger = createToken<Logger>('Logger');

interface Audit {
  record(entry: string): void;
}
const Audit = createToken<Audit>('Audit');

class MemoryLogger implements Logger, Audit {
  static built = 0;
  readonly lines: string[] = [];
  constructor() {
    MemoryLogger.built += 1;
  }
  log(message: string): void {
    this.lines.push(message);
  }
  record(entry: string): void {
    this.lines.push(entry);
  }
}

abstract class Store {
  abstract read(key: string): string | undefined;
}

class MemoryStore extends Store {
  read(key: string): string | undefined {
    return key === 'greeting' ? 'hello' : undefined;
  }
}

class Greeter {
  static readonly inject = [Logger, Store] as const;
  readonly logger: Logger;
  readonly store: Store;
  constructor(logger: Logger, store: Store) {
    this.logger = logger;
    this.store = store;
  }
}

test.skip('bind maps a concrete to an interface token and get builds it', async () => {
  const container = new Container();
  container.bind(MemoryLogger, Logger);

  const logger = await container.get(Logger);

  assert.ok(logger instanceof MemoryLogger, 'the token resolves to an instance of the bound concrete');
});

test.skip('every abstract in one bind call resolves to the same instance, built once', async () => {
  MemoryLogger.built = 0;
  const container = new Container();
  container.bind(MemoryLogger, Logger, Audit, MemoryLogger);

  const logger = await container.get(Logger);
  const audit = await container.get(Audit);
  const byClass = await container.get(MemoryLogger);
  const again = await container.get(Logger);

  assert.equal(MemoryLogger.built, 1);
  assert.equal(logger, audit);
  assert.equal(logger, byClass);
  assert.equal(logger, again);
});

test.skip('concurrent gets of different abstracts from one bind call build one instance', async () => {
  MemoryLogger.built = 0;
  const container = new Container();
  container.bind(MemoryLogger, Logger, Audit);

  const [logger, audit] = await Promise.all([container.get(Logger), container.get(Audit)]);

  assert.equal(MemoryLogger.built, 1);
  assert.equal(logger, audit);
});

test.skip('the inject list supplies constructor arguments in order, from their bindings', async () => {
  const container = new Container();
  container.bind(MemoryLogger, Logger).bind(MemoryStore, Store).bind(Greeter, Greeter);

  const greeter = await container.get(Greeter);
  const logger = await container.get(Logger);

  assert.ok(greeter instanceof Greeter, 'get builds the bound concrete');
  assert.equal(greeter.logger, logger, 'the first argument is the shared Logger binding');
  assert.ok(greeter.store instanceof MemoryStore, 'the second argument is built from the Store binding');
  assert.equal(greeter.store.read('greeting'), 'hello');
});

test.skip('bind returns the container so calls chain', () => {
  const container = new Container();

  const returned = container.bind(MemoryLogger, Logger);

  assert.equal(returned, container);
});

test.skip('has reports a class abstract and a token abstract after bind', () => {
  const container = new Container();
  assert.equal(container.has(Store), false, 'nothing is bound yet');
  assert.equal(container.has(Logger), false, 'nothing is bound yet');

  container.bind(MemoryStore, Store).bind(MemoryLogger, Logger);

  assert.equal(container.has(Store), true);
  assert.equal(container.has(Logger), true);
  assert.equal(container.has('Logger'), true, 'a typed token and a string token with the same name share a binding');
  assert.equal(container.has(MemoryStore), false, 'only the abstracts named in bind are bound');
});

test.skip('binding an abstract that is already bound throws and binds none of the call', async () => {
  const container = new Container();
  container.bind('Audit', () => ({ record: () => {} }));

  assert.throws(
    () => container.bind(MemoryLogger, Logger, Audit),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Audit' && error.reason === 'bound'
  );
  assert.equal(container.has(Logger), false, 'the abstract before the duplicate was not bound either');

  container.bind(MemoryStore, Store);
  assert.throws(
    () => container.bind(MemoryStore, Store),
    (error: unknown) => error instanceof DuplicateBindingError && error.reason === 'bound'
  );

  const later = new Container();
  later.bind(MemoryLogger, Logger);
  assert.throws(
    () => later.bind('Logger', () => new MemoryLogger()),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Logger' && error.reason === 'bound',
    'a 0.1 bind after a class bind of the same token collides'
  );
});

test.skip('two classes that share a name never share a binding', async () => {
  const makeClass = (label: string) =>
    class Widget {
      readonly label = label;
    };
  const First = makeClass('first');
  const Second = makeClass('second');
  assert.equal(First.name, Second.name, 'the fixture classes share a name');

  const container = new Container();
  container.bind(First, First);
  container.bind(Second, Second);

  assert.equal((await container.get(First)).label, 'first');
  assert.equal((await container.get(Second)).label, 'second');
});

test.skip('a string token in an inject list resolves a binding made under that string', async () => {
  class Welcome {
    static readonly inject = ['Greeting'] as const;
    readonly text: string;
    constructor(text: string) {
      this.text = text;
    }
  }
  const container = new Container();
  container.bind('Greeting', () => 'hello');
  container.bind(Welcome, Welcome);

  const welcome = await container.get(Welcome);

  assert.equal(welcome.text, 'hello');
});

test.skip('a 0.1 factory binding under a typed token satisfies an inject entry', async () => {
  const container = new Container();
  const lines: string[] = [];
  container.bind(Logger, () => ({ log: (message: string) => lines.push(message) }));
  container.bind(MemoryStore, Store);

  const greeter = await container.get(Greeter);
  greeter.logger.log('hi');

  assert.deepEqual(lines, ['hi']);
});

test.skip('a constructor error from the requested class passes through unchanged and nothing is cached', async () => {
  let attempts = 0;
  class Flaky {
    readonly attempt: number;
    constructor() {
      attempts += 1;
      if (attempts === 1) {
        throw new RangeError('first build fails');
      }
      this.attempt = attempts;
    }
  }
  const container = new Container();
  container.bind(Flaky, Flaky);

  await assert.rejects(() => container.get(Flaky), (error: unknown) => error instanceof RangeError);
  const second = await container.get(Flaky);

  assert.equal(second.attempt, 2);
  assert.equal(await container.get(Flaky), second, 'the successful build is cached');
});

test.skip('naming the same abstract twice in one bind call throws and binds nothing', () => {
  const container = new Container();

  assert.throws(
    () => container.bind(MemoryLogger, Logger, Audit, Logger),
    (error: unknown) => error instanceof DuplicateBindingError && error.token === 'Logger' && error.reason === 'repeated'
  );
  assert.equal(container.has(Logger), false);
  assert.equal(container.has(Audit), false);
});

test.skip('a failed build of a shared instance is not cached under any of its abstracts', async () => {
  let attempts = 0;
  class FlakyLogger implements Logger, Audit {
    constructor() {
      attempts += 1;
      if (attempts === 1) {
        throw new RangeError('first build fails');
      }
    }
    log(): void {}
    record(): void {}
  }
  const container = new Container();
  container.bind(FlakyLogger, Logger, Audit);

  await assert.rejects(() => container.get(Logger), RangeError);
  const audit = await container.get(Audit);
  const logger = await container.get(Logger);

  assert.equal(attempts, 2, 'the second abstract built again instead of replaying the failure');
  assert.equal(logger, audit, 'the successful build is shared by both abstracts');
});

test.skip('a rebind of one abstract while its shared build is in flight is not overwritten by that build', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class SlowLogger implements Logger, Audit {
    static readonly inject = ['Gate'] as const;
    constructor(gateDone: unknown) {
      void gateDone;
    }
    log(): void {}
    record(): void {}
  }
  const container = new Container();
  container.bind('Gate', () => gate);
  container.bind(SlowLogger, Logger, Audit);
  const replacement: Logger = { log: () => {} };

  const inFlight = container.get(Logger);
  container.rebind(Logger, () => replacement);
  release();
  const first = await inFlight;

  assert.ok(first instanceof SlowLogger, 'the get that started before the rebind finishes with the old binding');
  assert.equal(await container.get(Logger), replacement, 'the rebind stays in effect');
  assert.equal(await container.get(Audit), first, 'the other abstract keeps the shared instance');
});

test.skip('an old shared build that fails after a rebind leaves the rebound abstract cached', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class FailingLogger implements Logger, Audit {
    static readonly inject = ['Gate'] as const;
    constructor(gateDone: unknown) {
      void gateDone;
      throw new RangeError('old build failed');
    }
    log(): void {}
    record(): void {}
  }
  const container = new Container();
  container.bind('Gate', () => gate);
  container.bind(FailingLogger, Logger, Audit);
  let replacements = 0;

  const inFlight = container.get(Logger);
  container.rebind(Logger, () => {
    replacements += 1;
    return { log: () => {} };
  });
  const replacement = await container.get(Logger);
  release();
  await assert.rejects(inFlight, RangeError);

  assert.equal(await container.get(Logger), replacement, 'the old failure did not clear the new binding');
  assert.equal(replacements, 1, 'the new binding was built once');
});

test.skip('rebind replaces a class abstract and leaves the other abstracts of its bind call alone', async () => {
  class FixedStore extends Store {
    read(): string {
      return 'fixed';
    }
  }
  const container = new Container();
  container.bind(MemoryLogger, Logger, Audit);
  container.bind(MemoryStore, Store);
  const audit = await container.get(Audit);
  const before = await container.get(Store);

  container.rebind(Store, () => new FixedStore());
  const after = await container.get(Store);

  assert.ok(before instanceof MemoryStore);
  assert.ok(after instanceof FixedStore, 'the class abstract now resolves to the rebound factory');
  assert.equal(await container.get(Store), after, 'the rebound result is cached');
  assert.equal(await container.get(Audit), audit);
  assert.equal(container.has(Store), true);

  class Counter {
    readonly id: number;
    constructor(id = 1) {
      this.id = id;
    }
  }
  assert.equal((await container.get(Counter)).id, 1, 'Counter was autowired');
  container.rebind(Counter, () => new Counter(2));
  assert.equal((await container.get(Counter)).id, 2, 'rebind replaces an autowired class');
});

test.skip('bind and bindFactory refuse an abstract that get has already autowired', async () => {
  class SystemClock {
    now(): number {
      return 1;
    }
  }
  class FakeClock extends SystemClock {
    override now(): number {
      return 2;
    }
  }
  const container = new Container();
  await container.get(SystemClock);

  assert.throws(
    () => container.bind(FakeClock, SystemClock),
    (error: unknown) =>
      error instanceof DuplicateBindingError && error.token === 'SystemClock' && error.reason === 'autowired'
  );
  assert.throws(
    () => container.bindFactory(SystemClock, () => new FakeClock()),
    (error: unknown) => error instanceof DuplicateBindingError && error.reason === 'autowired'
  );
  assert.equal((await container.get(SystemClock)).now(), 1, 'the autowired instance is still the one served');
});

test.skip('bind refuses a class whose autowired build is still in flight, and one autowired as an inject entry', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class SlowStore extends Store {
    static readonly inject = ['Gate'] as const;
    constructor(gateDone: unknown) {
      super();
      void gateDone;
    }
    read(): string {
      return 'slow';
    }
  }
  const container = new Container();
  container.bind('Gate', () => gate);

  const inFlight = container.get(SlowStore);
  assert.throws(
    () => container.bind(MemoryStore, SlowStore as never),
    (error: unknown) => error instanceof DuplicateBindingError && error.reason === 'autowired',
    'an autowire still in flight counts'
  );
  release();
  assert.ok((await inFlight) instanceof SlowStore);

  class NeedsStore {
    static readonly inject = [Store] as const;
    readonly store: Store;
    constructor(store: Store) {
      this.store = store;
    }
  }
  const nested = new Container();
  await nested.get(NeedsStore);
  assert.throws(
    () => nested.bind(MemoryStore, Store),
    (error: unknown) => error instanceof DuplicateBindingError && error.reason === 'autowired',
    'a class autowired as an inject entry counts'
  );
});
