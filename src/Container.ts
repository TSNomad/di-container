/**
 * TSNomad Dependency Injection Container
 *
 * A simple DI container with string-token and typed-token bindings,
 * following the PHPNomad pattern. Supports both sync and async factory
 * functions with optional singleton caching.
 *
 * Usage:
 * ```typescript
 * const container = new Container();
 * container.bind('Logger', () => new ConsoleLogger());
 * container.bind('Database', async () => await connectDb(), true);
 *
 * const logger = await container.get<Logger>('Logger');
 *
 * const loggerToken = createToken<Logger>('Logger');
 * const typedLogger = await container.get(loggerToken); // inferred as Logger
 * ```
 */

import type { Token, TypedToken, AnyToken, Factory, Binding } from './types.js';
import { BindingNotFoundError, DuplicateBindingError } from './errors.js';

/**
 * Dependency injection container with string and typed token bindings.
 */
export class Container {
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
   * Registers a binding in the container.
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
  bind<T>(token: AnyToken<T>, factory: Factory<T>, singleton = true): void {
    const key = Container.keyOf(token);

    if (this.bindings.has(key)) {
      throw new DuplicateBindingError(key);
    }

    this.bindings.set(key, {
      factory: factory as Factory<unknown>,
      singleton,
    });
  }

  /**
   * Replaces an existing binding.
   * Useful for testing or reconfiguration.
   *
   * A typed token's name becomes the same string key a string token
   * would use, so rebinding through a typed token replaces a binding
   * made under a string token of the same name, and the reverse.
   *
   * @param token - Identifier for this binding, string or typed
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation (default: true)
   */
  rebind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: AnyToken<T>, factory: Factory<T>, singleton = true): void {
    const key = Container.keyOf(token);

    // Clear cached instance if replacing
    this.instances.delete(key);

    this.bindings.set(key, {
      factory: factory as Factory<unknown>,
      singleton,
    });
  }

  /**
   * Retrieves an instance from the container.
   *
   * A typed token infers its return type with no generic argument at
   * the call site, because its name resolves to the same binding a
   * string token of that name would resolve to.
   *
   * @param token - Identifier for the binding, string or typed
   * @returns Promise resolving to the instance
   * @throws BindingNotFoundError if the token's name is not bound
   * If a singleton's factory rejects, the pending slot clears and the
   * rejection propagates through the returned promise, so a later
   * `get` retries the factory instead of replaying the failure.
   */
  get<T>(token: TypedToken<T>): Promise<T>;
  get<T>(token: Token): Promise<T>;
  async get<T>(token: AnyToken<T>): Promise<T> {
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
  has(token: Token): boolean;
  has<T>(token: AnyToken<T>): boolean {
    return this.bindings.has(Container.keyOf(token));
  }

  /**
   * Gets all bound tokens.
   *
   * @returns Array of token strings
   */
  getTokens(): Token[] {
    return Array.from(this.bindings.keys());
  }
}
