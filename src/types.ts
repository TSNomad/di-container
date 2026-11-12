/**
 * TSNomad Container Types
 *
 * Dependency injection container following the PHPNomad pattern.
 * A binding is keyed by an abstract: a class, a typed token standing in
 * for an interface, or a plain string token kept for 0.1 callers.
 */

import type { InstanceProvider } from './InstanceProvider.js';

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

/**
 * A class the container can construct.
 */
export type Constructor<T = unknown, A extends readonly unknown[] = any[]> = new (...args: A) => T;

/**
 * Any class, abstract or not, used as the key of a binding. TypeScript
 * keeps classes at runtime, so a class is its own token, the way PHP
 * reads `Foo::class`.
 */
export type AbstractConstructor<T = unknown> = abstract new (...args: any[]) => T;

/**
 * What a binding is keyed by and what `get` resolves: a class, or a
 * typed token that stands in for an interface. TypeScript erases
 * interfaces, so an interface file exports a typed token with the same
 * name as the interface.
 */
export type Abstract<T> = TypedToken<T> | AbstractConstructor<T>;

/**
 * Any abstract, typed or not, including a plain string token.
 */
export type AnyAbstract = Abstract<any> | Token;

/**
 * One entry in a class's `inject` list. A typed token or a class is
 * checked against the constructor parameter in the same position. A
 * string token is accepted for bindings made under a string and is not
 * type checked.
 */
export type InjectEntry<T> = Abstract<T> | Token;

/**
 * The `inject` list a constructor with parameters `P` must declare: one
 * entry per parameter, in order, each resolving to that parameter's type.
 */
export type InjectList<P extends readonly unknown[]> = {
  readonly [K in keyof P]: InjectEntry<P[K]>;
};

/**
 * The static side a class needs before the container can autowire it.
 * A constructor with no parameters needs nothing. A constructor with
 * parameters needs `static readonly inject = [...] as const`, one entry
 * per parameter, checked here against the constructor at compile time.
 */
export type Injectable<C> = C extends abstract new (...args: infer P) => any
  ? P extends readonly []
    ? { readonly inject?: readonly [] }
    : { readonly inject: InjectList<P> }
  : never;

/**
 * The type an abstract resolves to. A string token resolves to unknown.
 */
export type AbstractType<A> = A extends TypedToken<infer I>
  ? I
  : A extends AbstractConstructor<infer I>
    ? I
    : unknown;

/**
 * Keeps each abstract in a `bind` call only when the concrete's instance
 * type `T` satisfies it, so binding a class to an interface it does not
 * implement fails to compile.
 */
export type BindableAbstracts<T, A extends readonly unknown[]> = {
  [K in keyof A]: T extends AbstractType<A[K]> ? A[K] : never;
};

/**
 * A factory registered with `bindFactory`. It receives an
 * InstanceProvider that resolves through the container and tracks the
 * resolution in progress, so it can get what it needs and a loop is
 * caught. It may be sync or async.
 */
export type ContainerFactory<T> = (container: InstanceProvider) => T | Promise<T>;
