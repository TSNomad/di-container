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

## Where this differs from PHPNomad

The architecture note, `docs/architecture/ncc-slice-6.md`, keeps the
list of differences and the reason for each.

## Extracted 2026-09-17

This package was extracted on 2026-09-17 from a prototype carried inside
three Novatorius CLIs.

## License

MIT.
