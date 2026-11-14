/**
 * @tsnomad/di-container
 *
 * Public entry point. Re-exports the container class, its interfaces and
 * their tokens, its types, and its error classes so consumers can import
 * everything from the package root.
 */

export { Container } from './Container.js';
export { InstanceProvider } from './InstanceProvider.js';
export { HasBindings } from './HasBindings.js';
export { CanSetContainer } from './CanSetContainer.js';
export type {
  Token,
  TypedToken,
  AnyToken,
  Factory,
  Binding,
  Constructor,
  AbstractConstructor,
  Abstract,
  AnyAbstract,
  InjectEntry,
  InjectList,
  Injectable,
  AbstractType,
  BindableAbstracts,
  ContainerFactory,
} from './types.js';
export { createToken } from './createToken.js';
export {
  DiException,
  ContainerError,
  BindingNotFoundError,
  DuplicateBindingError,
  AutowireError,
  CircularDependencyError,
} from './errors.js';
export type { DuplicateBindingReason, AutowireReason } from './errors.js';
