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
  Binding,
  AnyAbstract,
  AbstractConstructor,
  BindableAbstracts,
  Constructor,
  ContainerFactory,
  Injectable,
} from './types.js';
import type { InstanceProvider } from './InstanceProvider.js';
import type { HasBindings } from './HasBindings.js';
import { BindingNotFoundError, DuplicateBindingError } from './errors.js';

/**
 * Dependency injection container with class, typed token and string
 * token bindings.
 */
export class Container implements InstanceProvider, HasBindings {
  /**
   * Registered bindings keyed by token name.
   */
  private bindings = new Map<Token, Binding<unknown>>();

  /**
   * Cached singleton instances keyed by token name.
   *
   * While a singleton's factory is running, the entry for its key holds
   * the pending promise returned by that factory, not the resolved
   * value yet. `get` stores it there synchronously before awaiting it,
   * so a concurrent `get` for the same key finds the pending
   * promise already cached instead of racing the factory. Once the
   * promise settles, the entry is replaced with the resolved instance.
   */
  private instances = new Map<Token, unknown>();

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
      // Stub: the PHPNomad form is not implemented yet. See
      // docs/architecture/ncc-slice-6.md.
      return this;
    }

    const token = first;
    const factory = rest[0] as Factory<unknown>;
    const singleton = rest.length > 1 ? (rest[1] as boolean) : true;
    const key = Container.keyOf(token);

    if (this.bindings.has(key)) {
      throw new DuplicateBindingError(key, 'bound');
    }

    this.bindings.set(key, {
      factory: factory as Factory<unknown>,
      singleton,
    });
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
  bindFactory(_abstract: AnyAbstract, _factory: ContainerFactory<unknown>): this {
    // Stub: not implemented yet. See docs/architecture/ncc-slice-6.md.
    return this;
  }

  /**
   * Replaces an existing binding, or adds one.
   * Useful for testing or reconfiguration.
   *
   * A typed token's name becomes the same string key a string token
   * would use, so rebinding through a typed token replaces a binding
   * made under a string token of the same name, and the reverse.
   *
   * A class abstract is keyed by the class, as in `bind`. Its new
   * binding is a factory that receives an InstanceProvider, as a
   * `bindFactory` factory does, and its result is cached. Rebinding a
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
  rebind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: AnyToken<T> | AbstractConstructor<T>, factory: Factory<T> | ContainerFactory<T>, singleton = true): void {
    if (typeof token === 'function') {
      // Stub: class abstracts are not implemented yet. See
      // docs/architecture/ncc-slice-6.md.
      return;
    }

    const key = Container.keyOf(token);

    // Clear cached instance if replacing
    this.instances.delete(key);

    this.bindings.set(key, {
      factory: factory as Factory<unknown>,
      singleton,
    });
  }

  /**
   * Retrieves an instance from the container, autowiring constructors.
   *
   * A class that nothing is bound to is built from its static `inject`
   * list and cached, as PHPNomad autowires and caches an unbound class.
   * That holds even when the same class is bound under another abstract:
   * `get(Impl)` after `bind(Impl, Contract)` builds its own `Impl`,
   * because only the abstracts named in `bind` share an instance. A class
   * needs no `inject` list when neither its constructor nor any
   * constructor it inherits declares a parameter. A subclass inherits
   * its parent's `inject` list unless it declares its own.
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
    if (typeof abstract === 'function') {
      // Stub: class abstracts and autowiring are not implemented yet.
      // See docs/architecture/ncc-slice-6.md. `undefined` is the stub's
      // tolerated placeholder, the one value the contract never returns.
      return undefined as unknown as T;
    }

    const token = abstract;
    const key = Container.keyOf(token);

    // Check for cached singleton, or a singleton resolution already in flight
    if (this.instances.has(key)) {
      return this.instances.get(key) as T;
    }

    // Get binding
    const binding = this.bindings.get(key);
    if (!binding) {
      throw new BindingNotFoundError(key, Array.from(this.bindings.keys()));
    }

    if (!binding.singleton) {
      return (await binding.factory()) as T;
    }

    // Claim the cache slot with the pending promise before awaiting it,
    // so a concurrent `get` for this key finds it here instead of
    // calling the factory a second time.
    const pending = Promise.resolve(binding.factory());
    this.instances.set(key, pending);

    try {
      const instance = await pending;

      // Only settle the cache if this binding is still the one in
      // effect. A `rebind` that landed while this factory was running
      // already cleared the slot for its own binding, and this stale
      // resolution must not overwrite it.
      if (this.bindings.get(key) === binding) {
        this.instances.set(key, instance);
      }

      return instance as T;
    } catch (error) {
      if (this.bindings.get(key) === binding) {
        this.instances.delete(key);
      }

      throw error;
    }
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
    if (typeof abstract === 'function') {
      // Stub: class abstracts are not implemented yet. A class counts as
      // bound only when `bind` or `bindFactory` named it, never because
      // `get` could autowire it.
      return false;
    }

    return this.bindings.has(Container.keyOf(abstract));
  }

  /**
   * Gets all bound tokens.
   *
   * A class abstract appears under its class name.
   *
   * @returns Array of token strings
   */
  getTokens(): Token[] {
    return Array.from(this.bindings.keys());
  }
}
