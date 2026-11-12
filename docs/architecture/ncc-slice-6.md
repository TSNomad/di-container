# Container reshape toward PHPNomad

Status: architecture phase. Stubs and acceptance tests are committed.
The acceptance tests are marked `test.skip` until each packet lands.

This is slice 6 of the Siren Node commerce connectors build, the
container half. The event half lives in the event repository, in its own
`docs/architecture/ncc-slice-6.md`, on the branch of the same name. The
design behind both is
[Design: Siren Node commerce connectors (Source 16182)](https://navigator.novatori.us/r/source/16182),
section 2, and the rule both follow is
[TS Nomad Mirrors PHPNomad (KB 854)](https://navigator.novatori.us/r/kb/854).

## What changes

The container learns PHPNomad's three calls.

```ts
class ForwardedEventSender implements QueueConsumer {
  static readonly inject = [ConnectionStore, LoggerStrategy] as const;
  constructor(connections: ConnectionStore, logger: LoggerStrategy) {}
}

container
  .bind(ForwardedEventSender, QueueConsumer)               // PHP: bind(Concrete::class, Abstract::class)
  .bindFactory(LoggerStrategy, () => new ConsoleLogger()); // PHP: bindFactory(Abstract::class, $factory)

const consumer = await container.get(QueueConsumer);      // PHP: get(Abstract::class)
```

- `bind(concrete, abstract, ...abstracts)` maps one class to one or more
  abstracts. All of them share one instance, built on the first `get`.
- `bindFactory(abstract, factory)` maps an abstract to a factory that
  receives the container. Its result is cached, as PHPNomad caches it.
- `get(abstract)` resolves a class, a typed token or a string token. A
  class nothing is bound to is autowired and cached, as in PHPNomad.

An abstract is a class or a typed token. A class is keyed by the class
itself, so two classes with the same name never share a binding. A
token is keyed by its name, as today.

Autowiring reads a static `inject` list. TypeScript erases parameter
types, so the container cannot read them the way PHP reflection does.
The `Injectable<C>` type ties the list to the constructor at compile
time: one entry per parameter, each a token or class whose type fits
that parameter. A class with no constructor parameters needs no list.
A class that needs parameters and has no list, or a list shorter than
its constructor, fails at resolve time with an `AutowireError` naming
the class.

The three PHPNomad interfaces arrive with same-named tokens:
`InstanceProvider` (`get`), `HasBindings` (`bind`, `bindFactory`) and
`CanSetContainer` (`setContainer`). `Container` implements the first two.

`DiException` becomes the base error, PHPNomad's name. `ContainerError`
stays as a deprecated alias of the same class. Two errors are new:
`AutowireError` (fields `concrete`, `dependency`, and `cause`) and its
subclass `CircularDependencyError` (field `path`).

The 0.1 surface stays as it is: `bind(token, factory, singleton)`,
`rebind`, `has`, `getTokens`, string and typed tokens, and the
concurrency-safe singleton cache.

## Contract details the tests pin

- A `bind` call whose abstracts include one that is already bound throws
  `DuplicateBindingError` and binds none of them. `bindFactory` on a
  bound abstract throws the same error. 0.1 and new forms collide with
  each other, because they share one key space.
- Concurrent gets of two abstracts from one `bind` call build one
  instance. Concurrent gets of one factory binding run the factory once.
- `get(Impl)` after `bind(Impl, Contract)` builds a separate `Impl`,
  because only the abstracts named in `bind` share an instance. This is
  PHPNomad's behavior. Name `Impl` in the call to share it.
- `has` is true only for an abstract that `bind` or `bindFactory` named.
  A class `get` autowired is not reported as bound.
- Errors from the requested binding's own constructor or factory pass
  through unchanged, and nothing is cached, so a later `get` retries.
- A failure while resolving an `inject` entry becomes an `AutowireError`
  naming the class being built and the entry, with the failure as
  `cause`. Two levels down, the error is wrapped once per level.
- `inject` lists that form a loop reject with `CircularDependencyError`
  before any constructor in the loop runs. Its `path` reads
  `['Left', 'Right', 'Left']`, and the message carries the same path.
  Concurrent gets that enter the loop at different classes both reject.
  Without this check, the pending-promise cache would leave both gets
  waiting on each other forever. The walk follows `bind` targets and
  `inject` lists. It cannot see inside a factory, so a factory that
  resolves its own abstract is not caught.

## Where this differs from PHPNomad

- `get` returns a promise, because factories may be async.
- Autowiring reads `static inject`, not reflection. No decorators and no
  `reflect-metadata`, so consumers need no compiler flags.
- Binding an abstract twice throws instead of replacing the first
  binding. `rebind` replaces on purpose.
- The container does not check the resolved instance with `instanceof`.
  A structural fake for a class abstract, such as an object literal in a
  test, is normal TypeScript, and the compile-time check already ties a
  concrete to its abstracts.
- A parameter with a default value is not filled from its default when
  the entry cannot resolve. The `inject` list is explicit, so a missing
  binding is a wiring mistake.

## Files

| File | Role | State |
|---|---|---|
| `src/types.ts` | `Constructor`, `AbstractConstructor`, `Abstract`, `AnyAbstract`, `InjectEntry`, `InjectList`, `Injectable`, `AbstractType`, `BindableAbstracts`, `ContainerFactory` | final |
| `src/InstanceProvider.ts`, `src/HasBindings.ts`, `src/CanSetContainer.ts` | PHPNomad interfaces and their tokens | final |
| `src/errors.ts` | `DiException`, `ContainerError` alias, `AutowireError`, `CircularDependencyError` | final, data carriers with no logic |
| `src/Container.ts` | the class path of `bind`, `bindFactory`, `get`, `has` | stubbed |

The stubs return a valid value and never throw. `bind` and `bindFactory`
return `this` without storing, `get` of a class returns `undefined`, and
`has` of a class returns `false`. The string and typed token paths are
untouched. Message wording for the new errors is the implementer's, as
long as each message names what the tests require.

## Acceptance tests

| File | What it proves |
|---|---|
| `test/bind-concrete.test.ts` | `bind` to tokens and classes, the shared instance, order of `inject` arguments, chaining, `has`, the duplicate rule, identity keys, string entries, 0.1 bindings as entries, a constructor error passing through |
| `test/autowire-unbound.test.ts` | autowiring an unbound class, caching it, the separate instance for a concrete bound elsewhere, `has` staying false |
| `test/autowire-errors.test.ts` | each autowiring error: missing and short `inject` lists, an unbound entry, wrapping two levels down, a failing dependency constructor, loops, concurrent loops, loops through a token |
| `test/bind-factory.test.ts` | `bindFactory`: result, container argument, one run under concurrency, class abstracts, retry after rejection, chaining, the duplicate rule |
| `test/autowire-type-safety.ts` | compile-only: `inject` lists checked against constructors, concretes checked against abstracts, factory return types, inferred `get` types |

`npm test` builds and runs every file. `npm run typecheck` checks the
compile-only file. The runtime tests import `dist`, as the typed-token
tests already do.

## Proof

Each runtime acceptance test was run against a scratch implementation in
a separate clone, which was then thrown away. All 46 tests passed.
Then 32 mutations, one per guard, each built cleanly, and 31 turned the
suite red with the expected tests failing. The harness ran three
controls each round: a break it must catch, a comment it must not, and a
syntax error it must refuse to score. It also refused three mutations
whose build failed, and those were rewritten until they compiled. The
32nd survived by design: it changed a line the scratch
implementation never reaches, because its cycle check runs before any
build starts. Each `@ts-expect-error` line was proven the same way, by
loosening the signature it guards (nine mutations, each leaving the
directive unused). The harness and its logs live in the run notes.

## Consumer check

The slice is done only when the five current consumers build and test
against the two branches. `scripts/consumer-check.sh` does that in
throwaway clones. It reads the consumer list from a file you pass it,
points `@tsnomad/di-container` and `@tsnomad/event` at exact commits
through package manager overrides, and records each install, build and
test exit code. It never pushes. The run notes hold the list and the
results.

A consumer passes when it installs and builds, and its failing tests
are the same set as in a baseline run of its own main branch on the
same day. Two consumers already fail tests on main, so a red exit code
alone proves nothing. A consumer that stops compiling because of the
event package's 0.2.0 breaks passes when only the fixes listed in the
event note are applied, and the report names each fix.
