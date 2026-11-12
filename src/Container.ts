/**
 * TSNomad Dependency Injection Container
 *
 * The TypeScript counterpart of PHPNomad's `PHPNomad\Di\Container\Container`.
 * It binds concrete classes to abstracts, binds factories, and autowires
 * constructors from each class's static `inject` list.
 *
 * Usage:
 * ```typescript
 * class ForwardedEventSender implements QueueConsumer {
 *   static readonly inject = [ConnectionStore, LoggerStrategy] as const;
 *   constructor(connections: ConnectionStore, logger: LoggerStrategy) {}
 * }
 *
 * const container = new Container();
 * container
 *   .bind(ForwardedEventSender, QueueConsumer)          // PHP: bind(Concrete::class, Abstract::class)
 *   .bindFactory(LoggerStrategy, () => new ConsoleLogger());
 *
 * const consumer = await container.get(QueueConsumer);  // inferred as QueueConsumer
 * ```
 *
 * The 0.1 form, `bind(token, factory, singleton)`, still works for
 * string and typed tokens.
 *
 * docs/architecture/ncc-slice-6.md lists where this differs from
 * PHPNomad and why.
 */

import type {
  Token,
  TypedToken,
  AnyToken,
  Factory,
  AnyAbstract,
  AbstractConstructor,
  BindableAbstracts,
  Constructor,
  ContainerFactory,
  Injectable,
} from './types.js';
import type { InstanceProvider } from './InstanceProvider.js';
import type { HasBindings } from './HasBindings.js';
import {
  AutowireError,
  BindingNotFoundError,
  CircularDependencyError,
  DuplicateBindingError,
} from './errors.js';
import type { DuplicateBindingReason } from './errors.js';

/**
 * What a binding or an autowired class is stored under: the class
 * itself for a class abstract, the name for a typed or string token.
 */
type Key = Token | Function;

/**
 * One build in flight: the run of a factory, of a class `bind`, or of an
 * autowire. `waits` maps each build this one is waiting on right now to
 * the name it asked for. The container walks these edges to find a
 * loop, including one that two concurrent gets enter at different
 * abstracts.
 */
interface BuildNode {
  promise: Promise<unknown>;
  readonly waits: Map<BuildNode, string>;
}

/**
 * The cache of one binding, or of one class `bind` call shared by all
 * its abstracts, or of one autowired class. `pending` holds the build in
 * flight, so concurrent gets wait for it instead of starting another.
 * Each binding record owns its own slot, so a `rebind`, which installs
 * a new record, never sees a build of the record it replaced.
 */
interface Slot {
  pending?: BuildNode;
  hasInstance: boolean;
  instance?: unknown;
}

/**
 * A binding, as the container stores it.
 * - `legacy`: the 0.1 `bind(token, factory, singleton)`. The factory
 *   takes no provider.
 * - `factory`: `bindFactory` and `rebind`. The factory receives a
 *   provider tied to its run.
 * - `class`: one abstract of a class `bind` call. Every abstract of the
 *   call points at the same slot.
 * A record that is not a singleton never fills its slot. A `factory`
 * record lists its runs in flight in `running`, for the loop check.
 */
type BindingRecord =
  | { readonly kind: 'legacy'; readonly factory: Factory<unknown>; readonly singleton: boolean; readonly slot: Slot }
  | {
      readonly kind: 'factory';
      readonly factory: ContainerFactory<unknown>;
      readonly singleton: boolean;
      readonly slot: Slot;
      readonly running: Set<BuildNode>;
    }
  | { readonly kind: 'class'; readonly concrete: Constructor<object>; readonly slot: Slot };

/**
 * Dependency injection container with class, typed token and string
 * token bindings.
 */
export class Container implements InstanceProvider, HasBindings {
  /**
   * Registered bindings, keyed by the class for a class abstract and by
   * the name for a token. Every form of `bind`, `bindFactory` and
   * `rebind` writes here, so they collide with each other.
   *
   * Each record carries its own cache slot. While a singleton is being
   * built, its slot holds the build in flight, set synchronously before
   * anything is awaited, so a concurrent `get` waits for that build
   * instead of starting its own. Once the build succeeds, the slot holds
   * the instance. A failed build leaves the slot empty.
   */
  private bindings = new Map<Key, BindingRecord>();

  /**
   * Classes `get` autowired, each with its cache slot. A class is here
   * from the moment its `get` starts, which is what makes `bind` and
   * `bindFactory` refuse it, and leaves again when its build fails.
   */
  private autowired = new Map<Function, Slot>();

  /**
   * Resolves either kind of token to the plain string key the container
   * stores bindings and instances under. A typed token and a string
   * token with the same name resolve to the same key, so they refer to
   * the same binding.
   */
  private static keyOf<T>(token: AnyToken<T>): Token {
    return typeof token === 'string' ? token : token.name;
  }

  /**
   * The key any abstract is stored under: the class itself, or the
   * token's name.
   */
  private static keyOfAbstract(abstract: unknown): Key {
    if (typeof abstract === 'function') {
      return abstract;
    }
    if (typeof abstract === 'string') {
      return abstract;
    }
    if (abstract !== null && typeof abstract === 'object' && typeof (abstract as { name?: unknown }).name === 'string') {
      return (abstract as { name: string }).name;
    }
    throw new TypeError(`${String(abstract)} is not a class, a typed token or a string token`);
  }

  /**
   * The name an abstract goes by in errors and loop paths.
   */
  private static nameOf(abstract: unknown): string {
    if (typeof abstract === 'function' || (abstract !== null && typeof abstract === 'object')) {
      const name = (abstract as { name?: unknown }).name;
      if (typeof name === 'string') {
        return name;
      }
    }
    return String(abstract);
  }

  /**
   * Why a new binding under `key` would be refused, or undefined when it
   * may be added.
   */
  private refusal(key: Key): DuplicateBindingReason | undefined {
    if (this.bindings.has(key)) {
      return 'bound';
    }
    if (typeof key === 'function' && this.autowired.has(key)) {
      return 'autowired';
    }
    return undefined;
  }

  private static emptySlot(): Slot {
    return { hasInstance: false };
  }

  /**
   * Binds a concrete class to one or more abstracts, PHPNomad's
   * `bind(Concrete::class, Abstract::class, ...$abstracts)`.
   *
   * Every abstract in one call resolves to one shared instance, built
   * on the first `get` of any of them, even when those gets run
   * concurrently. The concrete's constructor arguments come from its
   * static `inject` list, resolved in order. A class abstract is keyed
   * by the class itself, so two classes that share a name never share a
   * binding. A typed or string token is keyed by its name.
   *
   * A build that fails is not cached under any of the abstracts, so the
   * next `get` of any of them builds again. A `rebind` of one abstract
   * while the shared build is in flight stays in effect when that build
   * finishes, and the other abstracts keep the shared instance.
   *
   * @param concrete - The class to build
   * @param abstracts - One or more abstracts the concrete satisfies
   * @returns this
   * @throws DuplicateBindingError if any abstract is already bound, by
   *   any form of `bind` or by `bindFactory`, is named twice in the
   *   call, or was already autowired by an earlier `get`. Nothing from
   *   the call is bound in that case.
   */
  bind<C extends Constructor<object>, const A extends readonly [AnyAbstract, ...AnyAbstract[]]>(
    concrete: C & Injectable<C>,
    ...abstracts: A & BindableAbstracts<InstanceType<C>, A>
  ): this;

  /**
   * Registers a factory binding in the container, the 0.1 form.
   *
   * A typed token's name becomes the same string key a string token
   * would use, so a typed token and a string token with the same name
   * share one binding and collide the same way two string tokens with
   * the same text already do.
   *
   * @param token - Identifier for this binding, string or typed
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation (default: true)
   * @throws DuplicateBindingError if the token's name is already bound
   */
  bind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  bind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;
  bind(
    first: AnyToken<unknown> | Constructor<object>,
    ...rest: unknown[]
  ): this | void {
    if (typeof first === 'function') {
      const keys: Key[] = [];
      for (const abstract of rest) {
        const key = Container.keyOfAbstract(abstract);
        const reason = keys.includes(key) ? 'repeated' : this.refusal(key);
        if (reason) {
          throw new DuplicateBindingError(Container.nameOf(abstract), reason);
        }
        keys.push(key);
      }

      const record: BindingRecord = { kind: 'class', concrete: first, slot: Container.emptySlot() };
      for (const key of keys) {
        this.bindings.set(key, record);
      }
      return this;
    }

    const token = first;
    const factory = rest[0] as Factory<unknown>;
    // An explicit undefined means the default, as the 0.1 default
    // parameter `singleton = true` read it.
    const singleton = rest[1] === undefined ? true : (rest[1] as boolean);
    const key = Container.keyOf(token);

    if (this.bindings.has(key)) {
      throw new DuplicateBindingError(key, 'bound');
    }

    this.bindings.set(key, { kind: 'legacy', factory, singleton, slot: Container.emptySlot() });
  }

  /**
   * Binds an abstract to a factory, PHPNomad's
   * `bindFactory(Abstract::class, $factory)`.
   *
   * The factory runs once, on the first `get`, even under concurrent
   * gets. Its result is shared from then on. A rejected or throwing
   * factory leaves nothing cached: every waiter on that run gets the
   * same error, and the next `get` runs the factory again.
   *
   * The factory receives an InstanceProvider. While the factory runs,
   * a `get` through it is part of the resolution in progress, so a loop
   * that passes through the factory fails with CircularDependencyError,
   * including a factory that gets its own abstract and concurrent gets
   * that enter a loop of factories at different abstracts. Two
   * resolutions that share a dependency with no loop both wait for its
   * one build. A factory may keep the provider. Once its run has
   * settled, a `get` through the kept provider resolves as a top-level
   * `get` would.
   *
   * A 0.1 factory calls the container it closes over, so its gets are
   * outside the resolution. A loop through 0.1 factories waits forever,
   * as it did in 0.1, and so does every later `get` of the abstracts in
   * that loop. Moving those factories to `bindFactory` puts them inside
   * the check.
   *
   * @param abstract - A class, a typed token, or a string token
   * @param factory - Builds the instance, sync or async
   * @returns this
   * @throws DuplicateBindingError if the abstract is already bound, by
   *   any form of `bind`, or was already autowired by an earlier `get`
   */
  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;
  bindFactory<T>(abstract: Token, factory: ContainerFactory<T>): this;
  bindFactory(abstract: AnyAbstract, factory: ContainerFactory<unknown>): this {
    const key = Container.keyOfAbstract(abstract);
    const reason = this.refusal(key);
    if (reason) {
      throw new DuplicateBindingError(Container.nameOf(abstract), reason);
    }

    this.bindings.set(key, Container.factoryRecord(factory, true));
    return this;
  }

  private static factoryRecord(factory: ContainerFactory<unknown>, singleton: boolean): BindingRecord {
    return { kind: 'factory', factory, singleton, slot: Container.emptySlot(), running: new Set() };
  }

  /**
   * Replaces an existing binding, or adds one.
   * Useful for testing or reconfiguration.
   *
   * A typed token's name becomes the same string key a string token
   * would use, so rebinding through a typed token replaces a binding
   * made under a string token of the same name, and the reverse.
   *
   * The factory receives an InstanceProvider, as a `bindFactory`
   * factory does, so a loop through it rejects with
   * CircularDependencyError. A factory that takes no argument, as 0.1
   * factories do, still fits. A class abstract is keyed by the class,
   * as in `bind`, and its result is always cached. Rebinding a
   * class that `get` already autowired replaces the autowired instance.
   *
   * Only the named key changes. When that key is one abstract of a
   * class `bind`, the others keep the shared instance. A build of the
   * old binding still in flight never overwrites the new one, whether
   * it succeeds or fails.
   *
   * @param token - Identifier for this binding: a class, a typed token
   *   or a string token
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation
   *   (default: true). Tokens only.
   */
  rebind<T>(abstract: AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): void;
  rebind<T>(token: TypedToken<T>, factory: ContainerFactory<T>, singleton?: boolean): void;
  rebind<T>(token: Token, factory: ContainerFactory<T>, singleton?: boolean): void;
  rebind<T>(token: AnyToken<T> | AbstractConstructor<T>, factory: ContainerFactory<T>, singleton = true): void {
    if (typeof token === 'function') {
      // A class rebind is always cached, and replaces an autowired
      // instance of the class.
      this.autowired.delete(token);
      this.bindings.set(token, Container.factoryRecord(factory as ContainerFactory<unknown>, true));
      return;
    }

    // The new record brings an empty slot, so the cache of the binding it
    // replaces, and any build of it still in flight, no longer counts.
    this.bindings.set(Container.keyOf(token), Container.factoryRecord(factory as ContainerFactory<unknown>, singleton));
  }

  /**
   * Retrieves an instance from the container, autowiring constructors.
   *
   * A class that nothing is bound to is built from its static `inject`
   * list and cached, as PHPNomad autowires and caches an unbound class.
   * That holds even when the same class is bound under another abstract:
   * `get(Impl)` after `bind(Impl, Contract)` builds its own `Impl`,
   * because only the abstracts named in `bind` share an instance. A class
   * needs no `inject` list when no constructor in its class chain
   * declares a parameter. A subclass inherits its parent's `inject` list
   * unless it declares its own. A subclass whose own constructor takes
   * no parameter, under a parent whose constructor does, declares
   * `static readonly inject = [] as const` to say so. Any other list is
   * held to the first constructor in the chain that declares parameters.
   *
   * Errors come back through the returned promise:
   * - BindingNotFoundError when a typed or string token is not bound.
   * - AutowireError, naming the class, when it, or a class it inherits
   *   its constructor from, takes constructor parameters and no
   *   `inject` list is declared, or the list is shorter than its
   *   constructor.
   * - AutowireError, naming the class and the failed entry, with the
   *   failure as `cause`, when an `inject` entry cannot be resolved.
   *   A failure two levels down is wrapped once per level.
   * - CircularDependencyError, with the loop as `path`, when `inject`
   *   lists form a loop, before any constructor in the loop runs, and
   *   also when concurrent gets enter the loop at different classes,
   *   and when a loop passes through a `bindFactory` factory's provider.
   *   Concurrent gets that share a dependency without a loop both wait
   *   for its one build.
   * - The requested binding's own factory or constructor error, as
   *   thrown.
   *
   * No rejection is cached, at any level. After any failure, the next
   * `get` of the same abstract, or of a class that needed it, tries
   * again. Concurrent gets waiting on one failed build all get its
   * error.
   *
   * A typed token infers its return type with no generic argument at
   * the call site, because its name resolves to the same binding a
   * string token of that name would resolve to.
   *
   * @param token - Identifier for the binding, string or typed
   * @returns Promise resolving to the instance
   * @throws BindingNotFoundError if the token's name is not bound
   */
  get<T>(token: TypedToken<T>): Promise<T>;
  get<T>(abstract: AbstractConstructor<T>): Promise<T>;
  get<T>(token: Token): Promise<T>;
  async get<T>(abstract: AnyToken<T> | AbstractConstructor<T>): Promise<T> {
    return (await this.resolve(abstract, null)) as T;
  }

  /**
   * Resolves an abstract for `requester`, the build that asked for it, or
   * for a top-level `get` when `requester` is null. Never throws: every
   * failure comes back as a rejected promise.
   *
   * Anything that marks the container, such as recording an autowire,
   * happens before this returns, so a `bind` right after a `get` that
   * has not settled already sees it.
   */
  private resolve(abstract: unknown, requester: BuildNode | null): Promise<unknown> {
    try {
      const key = Container.keyOfAbstract(abstract);
      const name = Container.nameOf(abstract);
      const record = this.bindings.get(key);

      if (record) {
        return this.resolveRecord(record, name, requester);
      }

      if (typeof key === 'function') {
        return this.autowire(key, name, requester);
      }

      return Promise.reject(new BindingNotFoundError(key, this.getTokens()));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Resolves through one binding record.
   */
  private resolveRecord(record: BindingRecord, name: string, requester: BuildNode | null): Promise<unknown> {
    switch (record.kind) {
      case 'class':
        return this.fromSlot(record.slot, name, requester, (node) => this.construct(record.concrete, node));

      case 'legacy': {
        // A 0.1 factory takes no provider. Its own gets go through the
        // container it closes over, outside this resolution.
        if (!record.singleton) {
          return Promise.resolve(record.factory());
        }
        return this.fromSlot(record.slot, name, requester, () => record.factory());
      }

      case 'factory': {
        const run = (node: BuildNode) => this.runFactory(record.factory, node);
        if (record.singleton) {
          return this.fromSlot(record.slot, name, requester, run);
        }
        return this.transient(record.running, name, requester, run);
      }
    }
  }

  /**
   * Resolves a class nothing is bound to, building it from its `inject`
   * list and caching it. The class is recorded as autowired before this
   * returns, and the record leaves again if the build fails.
   */
  private autowire(cls: Function, name: string, requester: BuildNode | null): Promise<unknown> {
    let slot = this.autowired.get(cls);
    if (!slot) {
      slot = Container.emptySlot();
      this.autowired.set(cls, slot);
    }

    return this.fromSlot(slot, name, requester, (node) => this.construct(cls as Constructor<object>, node), () => {
      this.autowired.delete(cls);
    });
  }

  /**
   * Serves a cached singleton: the instance when there is one, the build
   * in flight when there is one, or a new build.
   *
   * Waiting on a build in flight first checks that the build does not
   * wait, through any chain of builds, on `requester`. If it does, the
   * two would wait on each other forever, so the get rejects with
   * CircularDependencyError instead.
   *
   * The slot is updated before anyone waiting on the build sees it
   * settle, so a get that follows a failure never finds the failed
   * build. A failure is never cached.
   */
  private fromSlot(
    slot: Slot,
    name: string,
    requester: BuildNode | null,
    build: (node: BuildNode) => unknown,
    onFailure?: () => void
  ): Promise<unknown> {
    if (slot.hasInstance) {
      return Promise.resolve(slot.instance);
    }

    if (slot.pending) {
      return this.waitFor(slot.pending, name, requester);
    }

    const node = this.start(build, (settled) => {
      slot.pending = undefined;
      if (settled.ok) {
        slot.instance = settled.value;
        slot.hasInstance = true;
      } else {
        onFailure?.();
      }
    });
    slot.pending = node;
    return this.waitFor(node, name, requester);
  }

  /**
   * Runs a binding that is not a singleton. Each get gets its own build,
   * and the loop check looks at every run of the binding in flight.
   */
  private transient(
    running: Set<BuildNode>,
    name: string,
    requester: BuildNode | null,
    build: (node: BuildNode) => unknown
  ): Promise<unknown> {
    if (requester) {
      for (const other of running) {
        const loop = this.loopThrough(other, name, requester);
        if (loop) {
          return Promise.reject(loop);
        }
      }
    }

    const node = this.start(build, () => {
      running.delete(node);
    });
    running.add(node);
    return this.waitFor(node, name, requester);
  }

  /**
   * Starts a build on the next microtask, after the caller has stored the
   * node, so the build's own gets find it in the cache. `settle` runs
   * before anything awaiting `node.promise` resumes.
   */
  private start(
    build: (node: BuildNode) => unknown,
    settle: (result: { ok: true; value: unknown } | { ok: false }) => void
  ): BuildNode {
    const node: BuildNode = { promise: Promise.resolve(), waits: new Map() };
    node.promise = Promise.resolve()
      .then(() => build(node))
      .then(
        (value) => {
          settle({ ok: true, value });
          return value;
        },
        (error: unknown) => {
          settle({ ok: false });
          throw error;
        }
      );
    return node;
  }

  /**
   * Waits for `target` on behalf of `requester`, recording the wait so a
   * later loop check can see it, and dropping the record once `target`
   * settles. A top-level get, with no requester, just waits.
   */
  private waitFor(target: BuildNode, name: string, requester: BuildNode | null): Promise<unknown> {
    if (!requester) {
      return target.promise;
    }

    const loop = this.loopThrough(target, name, requester);
    if (loop) {
      return Promise.reject(loop);
    }

    // Every wait on one target ends when that target settles, so one edge
    // per target is enough, however many gets wait there.
    requester.waits.set(target, name);
    const release = () => {
      requester.waits.delete(target);
    };
    return target.promise.then(
      (value) => {
        release();
        return value;
      },
      (error: unknown) => {
        release();
        throw error;
      }
    );
  }

  /**
   * The CircularDependencyError for `requester` waiting on `target`,
   * which it asked for as `name`, or undefined when `target` does not
   * wait on `requester` through any chain of builds. The path starts and
   * ends with `name` and lists each name asked for along the way.
   */
  private loopThrough(target: BuildNode, name: string, requester: BuildNode): CircularDependencyError | undefined {
    const labels = Container.pathTo(target, requester);
    return labels ? new CircularDependencyError([name, ...labels, name]) : undefined;
  }

  /**
   * The names asked for along a chain of waits from `from` to `to`, or
   * undefined when there is none. An empty list means `from` is `to`.
   */
  private static pathTo(from: BuildNode, to: BuildNode): string[] | undefined {
    if (from === to) {
      return [];
    }
    // The waits never form a loop of their own, because every wait is
    // checked before it is recorded, so this walk always ends.
    for (const [next, label] of from.waits) {
      const rest = Container.pathTo(next, to);
      if (rest) {
        return [label, ...rest];
      }
    }
    return undefined;
  }

  /**
   * Runs a `bindFactory` or `rebind` factory with a provider tied to this
   * run. While the run is in flight, a get through the provider is part
   * of it, so the loop check sees it. Once the run has settled, the
   * provider resolves as a top-level `get` would.
   */
  private async runFactory(factory: ContainerFactory<unknown>, node: BuildNode): Promise<unknown> {
    let live = true;
    const provider = {
      get: (abstract: unknown) => (live ? this.resolve(abstract, node) : this.resolve(abstract, null)),
    } as InstanceProvider;

    try {
      return await factory(provider);
    } finally {
      live = false;
    }
  }

  /**
   * Builds a class from its static `inject` list, resolving each entry in
   * order as part of `node`.
   *
   * The requested class's own constructor error passes through as
   * thrown. An entry that fails is wrapped in an AutowireError naming
   * this class and the entry, except a loop, which passes through as the
   * CircularDependencyError that names it.
   */
  private async construct(concrete: Constructor<object>, node: BuildNode): Promise<object> {
    const inject = (concrete as { inject?: unknown }).inject;
    // An empty list says the class that declares it supplies its own
    // super arguments, so the walk stops there. Any other list, own or
    // inherited, and a missing one, are held to the first constructor in
    // the whole chain that declares parameters.
    const stop = Array.isArray(inject) && inject.length === 0 ? Container.ownerOfInject(concrete) : undefined;
    const needed = Container.parameterCount(concrete, stop);

    if (!Array.isArray(inject)) {
      if (needed > 0) {
        throw new AutowireError(concrete.name, 'no-inject');
      }
      return new concrete();
    }

    if (inject.length < needed) {
      throw new AutowireError(concrete.name, 'short-inject');
    }

    const args: unknown[] = [];
    for (const entry of inject) {
      try {
        args.push(await this.resolve(entry, node));
      } catch (error) {
        if (error instanceof CircularDependencyError) {
          throw error;
        }
        throw new AutowireError(concrete.name, 'dependency', Container.nameOf(entry), { cause: error });
      }
    }

    return new concrete(...args);
  }

  /**
   * How many parameters the first constructor in a class's chain that
   * declares any takes, or 0 when none does.
   *
   * JavaScript cannot tell a constructor a class wrote with no
   * parameters from one it inherits, or from the forwarding constructor
   * a compiler writes when it moves class fields into it for an older
   * target. Reading the source cannot settle it either, because minifiers
   * and compilers reshape it. So the walk never stops at a constructor
   * with no parameters. A class whose own constructor really takes none,
   * under a parent whose constructor takes some, declares an empty
   * `inject` list. The walk then stops at that class, after counting its
   * own constructor, and so it does for every subclass that inherits
   * the empty list. A rest parameter does not count, and neither does a
   * parameter with a default value or any parameter after one, because
   * `length` stops at the first default.
   */
  private static parameterCount(concrete: Function, stop?: Function): number {
    let current: unknown = concrete;
    while (typeof current === 'function' && current !== Function.prototype) {
      if (current.length > 0) {
        return current.length;
      }
      if (current === stop) {
        return 0;
      }
      current = Object.getPrototypeOf(current);
    }
    return 0;
  }

  /**
   * The class in a chain that declares the `inject` a class reads, the
   * nearest one with its own `inject`.
   */
  private static ownerOfInject(concrete: Function): Function | undefined {
    let current: unknown = concrete;
    while (typeof current === 'function' && current !== Function.prototype) {
      if (Object.prototype.hasOwnProperty.call(current, 'inject')) {
        return current;
      }
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  }

  /**
   * Checks if a token is bound in the container.
   *
   * A typed token's name resolves to the same binding a string token
   * of that name would resolve to.
   *
   * @param token - Identifier to check, string or typed
   * @returns True if the token has a binding
   */
  has<T>(token: TypedToken<T>): boolean;
  has<T>(abstract: AbstractConstructor<T>): boolean;
  has(token: Token): boolean;
  has<T>(abstract: AnyToken<T> | AbstractConstructor<T>): boolean {
    // A class counts as bound only when `bind`, `bindFactory` or
    // `rebind` named it, never because `get` autowired it.
    return this.bindings.has(Container.keyOfAbstract(abstract));
  }

  /**
   * Gets all bound tokens.
   *
   * A class abstract appears under its class name.
   *
   * @returns Array of token strings
   */
  getTokens(): Token[] {
    return Array.from(this.bindings.keys(), (key) => Container.nameOf(key));
  }
}
