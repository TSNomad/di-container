/**
 * TSNomad Container Types
 *
 * Dependency injection container following the PHPNomad pattern.
 * Uses string tokens for interface binding (similar to PHP's ::class).
 */

/**
 * String token identifying a binding.
 * Use interface names as tokens: 'AiStrategy', 'EventDispatcher', etc.
 */
export type Token = string;

/**
 * Factory function that creates an instance.
 * Can be sync or async to support lazy loading.
 */
export type Factory<T> = () => T | Promise<T>;

/**
 * Internal binding record stored in the container.
 */
export interface Binding<T> {
  /**
   * Factory function that creates the instance.
   */
  factory: Factory<T>;

  /**
   * Whether to cache the instance (singleton pattern).
   * If true, factory is called once and result is reused.
   */
  singleton: boolean;
}
