# @tsnomad/di-container

A dependency injection container in PHPNomad's shape. Bind a class to the
interfaces it satisfies, bind a factory, and ask the container for an
instance. The container builds classes from their static `inject` list.

This is the TypeScript counterpart to PHPNomad's
[di-container](https://github.com/phpnomad/di-container), the framework that
TSNomad follows in shape and naming.

## Install

```bash
npm install @tsnomad/di-container
```

## Use

```ts
import { Container, createToken } from '@tsnomad/di-container';

interface Logger { log(message: string): void }
const Logger = createToken<Logger>('Logger');

class Greeter {
  static readonly inject = [Logger] as const;
  constructor(private readonly logger: Logger) {}
}

const container = new Container();
container
  .bind(ConsoleLogger, Logger)       // PHP: bind(ConsoleLogger::class, Logger::class)
  .bindFactory(Clock, () => new SystemClock());

const greeter = await container.get(Greeter); // built from its inject list
```

The 0.1 form still works: `container.bind('Logger', () => new ConsoleLogger())`.

Binding an abstract twice throws a `DuplicateBindingError`. To swap one
for a test double, call `rebind`, which takes a class or a token:
`container.rebind(Clock, () => new FixedClock())`.

## Where this differs from PHPNomad

- `get` is async and returns a promise, because factories may be
  async. PHPNomad is synchronous. Node's I/O forces this one.
- Autowiring reads a static `inject` list, checked against the
  constructor at compile time, because TypeScript keeps no parameter
  types at run time. A subclass whose own constructor takes no
  parameter, under a parent whose constructor does, declares
  `static readonly inject = [] as const`.
- An interface is a typed token with the bare interface name, such as
  `'InstanceProvider'`, because TypeScript erases interfaces.
- Binding an abstract twice throws, and so does binding a class a `get`
  already autowired. PHPNomad replaces the binding. `rebind` replaces on
  purpose.
- A factory receives an `InstanceProvider`. A loop through `inject`
  lists, bound tokens or those factories throws
  `CircularDependencyError` instead of hanging. A loop through 0.1
  factories, which take no argument, still hangs, as it did in 0.1.
- The `InstanceProvider`, `HasBindings` and `CanSetContainer` interfaces
  live in this package, not in a separate `di` package.

The architecture note, `docs/architecture/ncc-slice-6.md`, gives the
reason for each and the full list.

## Extracted 2026-09-17

This package was extracted on 2026-09-17 from a prototype carried inside
three Novatorius CLIs.

## License

MIT.
