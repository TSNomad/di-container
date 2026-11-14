/**
 * CanSetContainer
 *
 * PHPNomad's `PHPNomad\Di\Interfaces\CanSetContainer`. An object that
 * needs the container handed to it after construction, such as an
 * initializer, implements this.
 */

import type { InstanceProvider } from './InstanceProvider.js';
import { createToken } from './createToken.js';

export interface CanSetContainer {
  /**
   * @param container - The instance provider to keep
   * @returns this
   */
  setContainer(container: InstanceProvider): this;
}

/**
 * Token for the CanSetContainer interface.
 */
export const CanSetContainer = createToken<CanSetContainer>('CanSetContainer');
