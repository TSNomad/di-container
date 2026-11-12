/**
 * InstanceProvider
 *
 * The read side of a container, PHPNomad's
 * `PHPNomad\Di\Interfaces\InstanceProvider`. Code that only needs to
 * resolve instances depends on this, not on the concrete `Container`.
 */

import type { AbstractConstructor, Token, TypedToken } from './types.js';
import { createToken } from './createToken.js';

export interface InstanceProvider {
  /**
   * Resolves an instance, autowiring constructor dependencies.
   *
   * Where this differs from PHPNomad: the result is a promise, because
   * a factory may be async.
   *
   * @throws DiException, through the returned promise, when nothing is
   *   bound and the abstract cannot be autowired
   */
  get<T>(abstract: TypedToken<T>): Promise<T>;
  get<T>(abstract: AbstractConstructor<T>): Promise<T>;
  get<T>(token: Token): Promise<T>;
}

/**
 * Token for the InstanceProvider interface, so code reads
 * `container.get(InstanceProvider)` as PHP reads
 * `$container->get(InstanceProvider::class)`.
 */
export const InstanceProvider = createToken<InstanceProvider>('InstanceProvider');
