/**
 * Container Error Classes
 *
 * Specific errors for container operations to enable targeted catch handling.
 */

/**
 * Base error for all container-related errors.
 */
export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

/**
 * Thrown when attempting to resolve an unbound token.
 */
export class BindingNotFoundError extends ContainerError {
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
export class DuplicateBindingError extends ContainerError {
  constructor(public readonly token: string) {
    super(`Token '${token}' is already bound. Use rebind() to replace.`);
    this.name = 'DuplicateBindingError';
  }
}
