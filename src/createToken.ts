/**
 * Typed Token Factory
 *
 * Builds the branded token that lets a container binding carry its own
 * type, so `bind` checks a factory against it and `get` returns the
 * right type with no generic argument at the call site.
 */

import type { TypedToken } from './types.js';

/**
 * Creates a typed token for a binding.
 *
 * The name is what the container keys the binding by, the same way a
 * string token already does. Two tokens with the same name, typed or
 * not, refer to the same binding.
 *
 * @param name - Readable name for this binding, e.g. 'Logger'
 * @returns A token that carries T as its bound type
 */
export function createToken<T>(name: string): TypedToken<T> {
  return { name } as TypedToken<T>;
}
