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
 * Marker used only at the type level to attach a binding's type to a
 * token. It never holds a real value at runtime, so it costs nothing at
 * runtime and never shows up when a token is logged or serialized.
 */
declare const tokenType: unique symbol;

/**
 * A token that carries its own type, so a binding's factory is checked
 * against it at compile time and a resolved value needs no cast.
 *
 * Create one with `createToken`. Two typed tokens, or a typed token and
 * a string token, that share the same `name` are the same binding as far
 * as the container is concerned, the same way two string tokens with the
 * same text already are.
 */
export interface TypedToken<T> {
  readonly name: string;
  readonly [tokenType]: T;
}

/**
 * Either kind of token a container method now accepts: the existing
 * string token, or a typed token carrying its own type.
 */
export type AnyToken<T> = Token | TypedToken<T>;

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
