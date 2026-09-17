/**
 * TSNomad Dependency Injection Container
 *
 * A simple DI container with string-token bindings, following the PHPNomad pattern.
 * Supports both sync and async factory functions with optional singleton caching.
 *
 * Usage:
 * ```typescript
 * const container = new Container();
 * container.bind('Logger', () => new ConsoleLogger());
 * container.bind('Database', async () => await connectDb(), true);
 *
 * const logger = await container.get<Logger>('Logger');
 * ```
 */

import type { Token, TypedToken, AnyToken, Factory, Binding } from './types.js';
import { BindingNotFoundError, DuplicateBindingError } from './errors.js';

/**
 * Dependency injection container with string token bindings.
 */
export class Container {
  /**
   * Registered bindings keyed by token.
   */
  private bindings = new Map<Token, Binding<unknown>>();

  /**
   * Cached singleton instances.
   */
  private instances = new Map<Token, unknown>();

  /**
   * Registers a binding in the container.
   *
   * A typed token checks the factory against its own type at compile
   * time. Binding through a typed token is not implemented yet, see
   * docs/architecture/typed-tokens.md. It is stubbed here so the
   * overload compiles and returns without touching container state.
   *
   * @param token - Identifier for this binding, string or typed
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation (default: true)
   * @throws DuplicateBindingError if token already bound
   */
  bind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  bind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;
  bind<T>(token: AnyToken<T>, factory: Factory<T>, singleton = true): void {
    if (typeof token !== 'string') {
      return;
    }

    if (this.bindings.has(token)) {
      throw new DuplicateBindingError(token);
    }

    this.bindings.set(token, {
      factory: factory as Factory<unknown>,
      singleton,
    });
  }

  /**
   * Replaces an existing binding.
   * Useful for testing or reconfiguration.
   *
   * Binding through a typed token is not implemented yet, see the
   * note on `bind`.
   *
   * @param token - Identifier for this binding, string or typed
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation (default: true)
   */
  rebind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: AnyToken<T>, factory: Factory<T>, singleton = true): void {
    if (typeof token !== 'string') {
      return;
    }

    // Clear cached instance if replacing
    this.instances.delete(token);

    this.bindings.set(token, {
      factory: factory as Factory<unknown>,
      singleton,
    });
  }

  /**
   * Retrieves an instance from the container.
   *
   * A typed token infers its return type with no generic argument at
   * the call site. Resolving through a typed token is not implemented
   * yet, see the note on `bind`. It is stubbed here to return a
   * hardcoded placeholder of the declared type rather than throw, so
   * the overload compiles and the method stays callable.
   *
   * @param token - Identifier for the binding, string or typed
   * @returns Promise resolving to the instance
   * @throws BindingNotFoundError if token is not bound
   */
  get<T>(token: TypedToken<T>): Promise<T>;
  get<T>(token: Token): Promise<T>;
  async get<T>(token: AnyToken<T>): Promise<T> {
    if (typeof token !== 'string') {
      return undefined as unknown as T;
    }

    // Check for cached singleton
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    // Get binding
    const binding = this.bindings.get(token);
    if (!binding) {
      throw new BindingNotFoundError(token, Array.from(this.bindings.keys()));
    }

    // Create instance
    const instance = await binding.factory();

    // Cache if singleton
    if (binding.singleton) {
      this.instances.set(token, instance);
    }

    return instance as T;
  }

  /**
   * Checks if a token is bound in the container.
   *
   * Checking a typed token is not implemented yet, see the note on
   * `bind`. It is stubbed here to always report unbound.
   *
   * @param token - Identifier to check, string or typed
   * @returns True if the token has a binding
   */
  has<T>(token: TypedToken<T>): boolean;
  has(token: Token): boolean;
  has<T>(token: AnyToken<T>): boolean {
    if (typeof token !== 'string') {
      return false;
    }

    return this.bindings.has(token);
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
