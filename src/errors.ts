/**
 * Container Error Classes
 *
 * Specific errors for container operations to enable targeted catch handling.
 * `DiException` is the base, named after PHPNomad's
 * `PHPNomad\Di\Exceptions\DiException`.
 */

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
 * Thrown when attempting to bind a token that's already bound.
 */
export class DuplicateBindingError extends DiException {
  constructor(public readonly token: string) {
    super(`Token '${token}' is already bound. Use rebind() to replace.`);
    this.name = 'DuplicateBindingError';
  }
}

/**
 * Thrown when the container cannot build a class: the class needs
 * constructor parameters but declares no `inject` list, its list is
 * shorter than its constructor, or one of its dependencies failed to
 * resolve. The container composes the message. It always names the
 * class, and names the dependency when one failed.
 */
export class AutowireError extends DiException {
  constructor(
    /** Name of the class the container was building. */
    public readonly concrete: string,
    message: string,
    /** Name of the inject entry that failed, when one did. */
    public readonly dependency?: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'AutowireError';
  }
}

/**
 * Thrown when classes depend on each other through their `inject`
 * lists in a loop, such as A needs B and B needs A.
 */
export class CircularDependencyError extends AutowireError {
  constructor(
    concrete: string,
    message: string,
    /** The loop, starting and ending with the same name, such as ['A', 'B', 'A']. */
    public readonly path: readonly string[]
  ) {
    super(concrete, message);
    this.name = 'CircularDependencyError';
  }
}
