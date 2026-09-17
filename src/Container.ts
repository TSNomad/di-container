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

import type { Token, Factory, Binding } from './types.js';
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
   * @param token - String identifier for this binding
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation (default: true)
   * @throws DuplicateBindingError if token already bound
   */
  bind<T>(token: Token, factory: Factory<T>, singleton = true): void {
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
   * @param token - String identifier for this binding
   * @param factory - Function that creates the instance
   * @param singleton - If true, instance is cached after first creation (default: true)
   */
  rebind<T>(token: Token, factory: Factory<T>, singleton = true): void {
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
   * @param token - String identifier for the binding
   * @returns Promise resolving to the instance
   * @throws BindingNotFoundError if token is not bound
   */
  async get<T>(token: Token): Promise<T> {
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
   * @param token - String identifier to check
   * @returns True if the token has a binding
   */
  has(token: Token): boolean {
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
