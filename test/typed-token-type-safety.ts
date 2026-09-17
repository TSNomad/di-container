/**
 * Compile-only check, not a runtime test. It has no `test()` or
 * `it()` call, so `node --test` reports it as an empty passing file
 * and moves on. `npm run typecheck` is what makes it matter.
 *
 * The overload on `bind` that takes a typed token is already the
 * architecture's finished public surface, not a stub, because a
 * parameter type is a signature the architecture phase owns outright.
 * Only the method body that runs when a typed token reaches it at
 * runtime is a placeholder. So this check already holds today: a
 * factory whose return type does not match the token's type must
 * fail to compile.
 *
 * If that overload is ever loosened, the `@ts-expect-error` below
 * stops suppressing a real error, TypeScript reports an unused
 * directive, and `npm run typecheck` fails.
 */

import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';

const portToken = createToken<number>('Port');
const container = new Container();

// A factory returning the token's own type compiles.
container.bind(createToken<number>('OtherPort'), () => 4000);

// @ts-expect-error a factory returning a string cannot satisfy a number token
container.bind(portToken, () => 'not a number');
