/**
 * Container Error Classes
 *
 * Specific errors for container operations to enable targeted catch handling.
 * `DiException` is the base, named after PHPNomad's
 * `PHPNomad\Di\Exceptions\DiException`.
 */

import { describeValue } from './describeValue.js';

/**
 * Base error for every failure the container raises.
 */
export class DiException extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DiException';
  }
}

/**
 * The 0.1 name of the base error. Same class as DiException.
 *
 * @deprecated Use DiException. Kept for 0.2.x.
 */
export { DiException as ContainerError };

/**
 * Thrown when attempting to resolve an unbound token.
 */
export class BindingNotFoundError extends DiException {
  constructor(
    public readonly token: string,
    public readonly availableTokens: string[]
  ) {
    const available = availableTokens.length > 0
      ? availableTokens.join(', ')
      : 'none';
    super(`Token '${token}' is not bound. Available: ${available}`);
    this.name = 'BindingNotFoundError';
  }
}

/**
 * Why a binding was refused.
 * - `'bound'`: the abstract already has a binding. `rebind` replaces it.
 * - `'repeated'`: one `bind` call names the abstract twice.
 * - `'autowired'`: an earlier `get` already autowired the class and
 *   cached it. Bind it before the first `get`.
 */
export type DuplicateBindingReason = 'bound' | 'repeated' | 'autowired';

/**
 * Thrown when attempting to bind a token that's already bound. The
 * message is built from the token and the reason, so each cause gives
 * advice that works for it.
 */
export class DuplicateBindingError extends DiException {
  constructor(
    public readonly token: string,
    /** Why the binding was refused. 0.1 callers get `'bound'`. */
    public readonly reason: DuplicateBindingReason = 'bound'
  ) {
    super(DuplicateBindingError.describe(token, reason));
    this.name = 'DuplicateBindingError';
  }

  private static describe(token: string, reason: DuplicateBindingReason): string {
    switch (reason) {
      case 'repeated':
        return `Abstract '${token}' is named twice in one bind() call.`;
      case 'autowired':
        return `Abstract '${token}' was already autowired by get(). Bind it before the first get().`;
      default:
        return `Token '${token}' is already bound. Use rebind() to replace.`;
    }
  }
}

/**
 * Why the container could not build a class.
 * - `'no-inject'`: the class, or a class it inherits its constructor
 *   from, takes constructor parameters and no `inject` list is declared.
 * - `'short-inject'`: the `inject` list is shorter than the constructor.
 * - `'dependency'`: an `inject` entry failed to resolve. The entry is in
 *   `dependency` and its failure in `cause`.
 * - `'circular'`: the class is part of a loop, see CircularDependencyError.
 */
export type AutowireReason = 'no-inject' | 'short-inject' | 'dependency' | 'circular';

/**
 * Thrown when the container cannot build a class. The message is built
 * from the fields. It always names the class, and names the dependency
 * when one failed, followed by the message of the error that caused it,
 * so the whole chain reads in one line. A cause that is not an Error is
 * named as text, a string as given.
 */
export class AutowireError extends DiException {
  constructor(
    /** Name of the class the container was building. */
    public readonly concrete: string,
    /** Why the class could not be built. */
    public readonly reason: AutowireReason,
    /** Name of the inject entry that failed, when one did. */
    public readonly dependency?: string,
    options?: { cause?: unknown }
  ) {
    super(AutowireError.describe(concrete, reason, dependency, options), options);
    this.name = 'AutowireError';
  }

  private static describe(
    concrete: string,
    reason: AutowireReason,
    dependency?: string,
    options?: { cause?: unknown }
  ): string {
    switch (reason) {
      case 'no-inject':
        return `${concrete} takes constructor parameters but declares no static inject list.`;
      case 'short-inject':
        return `${concrete}'s static inject list is shorter than its constructor.`;
      case 'dependency':
        // A cause given as anything, even undefined, is named, so a
        // factory that throws a string still says why. Only a missing
        // cause ends the sentence.
        return `Could not resolve ${dependency ?? 'an inject entry'} for ${concrete}`
          + (options !== undefined && 'cause' in options ? `: ${describeValue(options.cause)}` : '.');
      default:
        return `${concrete} is part of a dependency loop.`;
    }
  }
}

/**
 * Thrown when a resolution reaches an abstract it is already resolving,
 * through `inject` lists, bound tokens or `bindFactory` providers, such
 * as A needs B and B needs A. `concrete` is the first name in `path`.
 */
export class CircularDependencyError extends AutowireError {
  constructor(
    /** The loop, starting and ending with the same name, such as ['A', 'B', 'A']. */
    public readonly path: readonly string[]
  ) {
    super(path[0] ?? '', 'circular');
    this.message = `Circular dependency: ${path.join(' -> ')}`;
    this.name = 'CircularDependencyError';
  }
}
