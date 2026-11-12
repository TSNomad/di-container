/**
 * HasBindings
 *
 * The write side of a container, PHPNomad's
 * `PHPNomad\Di\Interfaces\HasBindings`.
 */

import type {
  AnyAbstract,
  BindableAbstracts,
  Constructor,
  ContainerFactory,
  Injectable,
  AbstractConstructor,
  Token,
  TypedToken,
} from './types.js';
import { createToken } from './createToken.js';

export interface HasBindings {
  /**
   * Binds a concrete class to one or more abstracts. Every abstract in
   * one call resolves to the same instance, built once, on first `get`.
   *
   * @param concrete - The class to build. Its static `inject` list names
   *   the abstracts for its constructor parameters, in order.
   * @param abstracts - One or more classes or typed tokens the concrete
   *   satisfies. A string token is also accepted.
   * @returns this, so calls chain as they do in PHPNomad
   * @throws DuplicateBindingError if any abstract is already bound, in
   *   which case none of them is bound
   */
  bind<C extends Constructor<object>, const A extends readonly [AnyAbstract, ...AnyAbstract[]]>(
    concrete: C & Injectable<C>,
    ...abstracts: A & BindableAbstracts<InstanceType<C>, A>
  ): this;

  /**
   * Binds an abstract to a factory. The factory runs once, on first
   * `get`, and its result is shared from then on, as in PHPNomad, where
   * the container caches whatever a factory returns.
   *
   * @param abstract - The class or typed token the factory's result satisfies
   * @param factory - Receives the container and returns the instance,
   *   sync or async
   * @returns this
   * @throws DuplicateBindingError if the abstract is already bound
   */
  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;
  bindFactory<T>(abstract: Token, factory: ContainerFactory<T>): this;
}

/**
 * Token for the HasBindings interface.
 */
export const HasBindings = createToken<HasBindings>('tsnomad/di/HasBindings');
