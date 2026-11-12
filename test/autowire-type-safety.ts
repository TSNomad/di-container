/**
 * Compile-only checks for the PHPNomad-shaped container surface. Not a
 * runtime test. Everything sits inside a function that never runs, so
 * `node --test` loads this file and reports it as an empty pass, and
 * `npm run typecheck` is what makes it matter.
 *
 * Each `@ts-expect-error` line is a call the types must reject. If a
 * signature is loosened so the call compiles, TypeScript reports the
 * directive as unused and `npm run typecheck` fails. The lines without
 * a directive must keep compiling.
 *
 * The signatures are the architecture's finished surface, so these
 * checks hold at stub time and carry no incomplete marker.
 */

import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';
import type { HasBindings } from '../dist/HasBindings.js';
import type { InstanceProvider } from '../dist/InstanceProvider.js';

interface Logger {
  log(message: string): void;
}
const Logger = createToken<Logger>('Logger');

interface Clock {
  now(): number;
}
const Clock = createToken<Clock>('Clock');

interface QueueConsumer {
  consume(): Promise<void>;
}
const QueueConsumer = createToken<QueueConsumer>('QueueConsumer');

abstract class Store {
  abstract read(key: string): string | undefined;
}

class ConsoleLogger implements Logger {
  log(_message: string): void {}
}

class MemoryStore extends Store {
  read(_key: string): string | undefined {
    return undefined;
  }
}

class Sender implements QueueConsumer {
  static readonly inject = [Logger, Store] as const;
  readonly logger: Logger;
  readonly store: Store;
  constructor(logger: Logger, store: Store) {
    this.logger = logger;
    this.store = store;
  }
  async consume(): Promise<void> {}
}

class NoInjectList implements QueueConsumer {
  readonly logger: Logger;
  constructor(logger: Logger) {
    this.logger = logger;
  }
  async consume(): Promise<void> {}
}

class WrongTokenType implements QueueConsumer {
  static readonly inject = [Clock] as const;
  readonly logger: Logger;
  constructor(logger: Logger) {
    this.logger = logger;
  }
  async consume(): Promise<void> {}
}

class ShortInjectList implements QueueConsumer {
  static readonly inject = [Logger] as const;
  readonly logger: Logger;
  readonly store: Store;
  constructor(logger: Logger, store: Store) {
    this.logger = logger;
    this.store = store;
  }
  async consume(): Promise<void> {}
}

class StringTokenEntry {
  static readonly inject = ['LegacyGreeting'] as const;
  readonly greeting: string;
  constructor(greeting: string) {
    this.greeting = greeting;
  }
}

export function typeChecks(container: Container): void {
  // A class whose inject list matches its constructor binds to an
  // interface token it implements, and the call chains.
  container.bind(Sender, QueueConsumer).bind(ConsoleLogger, Logger);

  // One concrete, several abstracts, a class abstract among them.
  container.bind(MemoryStore, Store, MemoryStore);

  // A string token entry is accepted and not type checked.
  container.bind(StringTokenEntry, StringTokenEntry);

  // A class with no constructor parameters needs no inject list.
  container.bind(ConsoleLogger, ConsoleLogger);

  // @ts-expect-error a class with constructor parameters must declare an inject list
  container.bind(NoInjectList, QueueConsumer);

  // @ts-expect-error an inject entry must resolve to its constructor parameter's type
  container.bind(WrongTokenType, QueueConsumer);

  // @ts-expect-error an inject list shorter than the constructor fails
  container.bind(ShortInjectList, QueueConsumer);

  // @ts-expect-error the concrete must satisfy every abstract it is bound to
  container.bind(ConsoleLogger, QueueConsumer);

  // @ts-expect-error the concrete must satisfy every abstract, not only the first
  container.bind(ConsoleLogger, Logger, Clock);

  // @ts-expect-error bind needs at least one abstract
  container.bind(ConsoleLogger);

  // A factory returning the abstract's type compiles, sync or async,
  // and may use the container it receives.
  container.bindFactory(Clock, () => ({ now: () => 0 }));
  container.bindFactory(Store, async (c) => {
    await c.get(Logger);
    return new MemoryStore();
  });

  // @ts-expect-error a factory must return the abstract's type
  container.bindFactory(Clock, () => 'not a clock');

  // @ts-expect-error a factory for a class abstract must return that class's instance type
  container.bindFactory(Store, () => 42);

  // rebind takes a class abstract with a factory that receives a provider.
  container.rebind(Store, async (c) => {
    await c.get(Logger);
    return new MemoryStore();
  });

  // @ts-expect-error a class rebind's factory must return that class's instance type
  container.rebind(Store, () => 42);
}

export async function resolvedTypes(container: Container): Promise<void> {
  // get infers the type from a typed token and from a class, with no
  // generic argument at the call site.
  const consumer: QueueConsumer = await container.get(QueueConsumer);
  const store: Store = await container.get(Store);
  const sender: Sender = await container.get(Sender);

  // @ts-expect-error a token's resolved type is the token's type, not another
  const wrong: Clock = await container.get(Logger);

  void consumer;
  void store;
  void sender;
  void wrong;
}

export async function viaInterfaces(bindings: HasBindings, provider: InstanceProvider): Promise<void> {
  // Code that depends on the interfaces gets the same checks as code
  // that holds the concrete Container.
  bindings.bind(Sender, QueueConsumer).bindFactory(Clock, () => ({ now: () => 0 }));

  // @ts-expect-error HasBindings checks inject lists against constructors
  bindings.bind(NoInjectList, QueueConsumer);

  // @ts-expect-error HasBindings checks the concrete against its abstracts
  bindings.bind(ConsoleLogger, QueueConsumer);

  // @ts-expect-error HasBindings checks factory return types
  bindings.bindFactory(Clock, () => 'not a clock');

  const consumer: QueueConsumer = await provider.get(QueueConsumer);
  const store: Store = await provider.get(Store);

  // @ts-expect-error InstanceProvider keeps the token's type
  const wrong: Clock = await provider.get(Logger);

  void consumer;
  void store;
  void wrong;
}
