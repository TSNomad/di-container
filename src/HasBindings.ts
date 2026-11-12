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
   * @throws DuplicateBindingError if any abstract is already bound,
   *   named twice in the call, or already autowired by an earlier `get`.
   *   None of the call's abstracts is bound in that case.
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
   * @param factory - Receives an InstanceProvider and returns the
   *   instance, sync or async. A `get` through that provider is part of
   *   the resolution in progress, so a loop through it fails with
   *   CircularDependencyError instead of waiting forever.
   * @returns this
   * @throws DuplicateBindingError if the abstract is already bound or
   *   already autowired by an earlier `get`
   */
  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;
  bindFactory<T>(abstract: Token, factory: ContainerFactory<T>): this;
}

/**
 * Token for the HasBindings interface.
 */
export const HasBindings = createToken<HasBindings>('HasBindings');
