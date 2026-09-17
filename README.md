# @tsnomad/di-container

A dependency injection container with string token bindings. Register a
factory for a token, then ask the container for it later. A factory can be
sync or async, and a binding can cache its result as a singleton or build a
fresh instance every time.

This is the TypeScript counterpart to PHPNomad's
[di-container](https://github.com/phpnomad/di-container), the framework that
TSNomad follows in shape and naming.

## Install

```bash
npm install @tsnomad/di-container
```

## Use

```ts
import { Container } from '@tsnomad/di-container';

const container = new Container();
container.bind('Logger', () => new ConsoleLogger());
const logger = await container.get('Logger');
```

## Extracted 2026-09-17

This package was extracted on 2026-09-17 from a prototype carried inside
three Novatorius CLIs.

## License

MIT.
