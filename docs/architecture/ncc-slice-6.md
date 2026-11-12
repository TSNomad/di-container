# Container reshape toward PHPNomad

Status: implemented. Packet P1, the container class path, landed on
this branch, and the slice review's fixes are in, up to abdf281. Every
acceptance test runs. The consumer check against the five current
consumers has not run yet.

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
- `bindFactory(abstract, factory)` maps an abstract to a factory. Its
  result is cached, as PHPNomad caches it.
- `get(abstract)` resolves a class, a typed token or a string token. A
  class nothing is bound to is autowired and cached, as in PHPNomad.

An abstract is a class or a typed token. A class is keyed by the class
itself, so two classes with the same name never share a binding. A
token is keyed by its name, as today.

Autowiring reads a static `inject` list. TypeScript erases parameter
types, so the container cannot read them the way PHP reflection does.
The `Injectable<C>` type ties the list to the constructor at compile
time: one entry per parameter, each a token or class whose type fits
that parameter. A class needs no list when no constructor in its class
chain declares a parameter. A subclass inherits its parent's list
unless it declares its own. A missing list, and any list but an empty
one, own or inherited, is held to the first constructor in the whole
chain that declares parameters. An empty list,
`static readonly inject = [] as const`, ends that walk at the class that
declares it: the container counts constructors from the requested class
up to and including that class, and never looks above it. That is how a
subclass whose own constructor takes no parameter, under a parent whose
constructor does, says so. JavaScript cannot tell such a constructor
from an inherited one, or from the forwarding constructor a compiler
writes for class fields, so the container never takes a constructor
with no parameters as the end of the walk on its own. A class that needs
parameters and has no list, or a list shorter than the constructor it
is held to, fails at resolve time with an `AutowireError` naming the
class.

The walk reads each constructor's `length`, which cannot see three
kinds of parameter: a rest parameter, a parameter with a default value,
and any parameter after one with a default. So an unbound class whose
constructor takes only `...deps` builds with no arguments unless it
declares a list, and a class whose parameters all have defaults builds
with its defaults. `bind` still rejects such a class at compile time
when the list is missing.

The three PHPNomad interfaces arrive with same-named tokens:
`InstanceProvider` (`get`), `HasBindings` (`bind`, `bindFactory`) and
`CanSetContainer` (`setContainer`). `Container` implements the first two.
Each token's name is its interface's name, the convention this
package's typed tokens set.

`DiException` becomes the base error, PHPNomad's name. `ContainerError`
stays as a deprecated alias of the same class. Two errors are new:
`AutowireError` (fields `concrete`, `reason`, `dependency`, and `cause`)
and its subclass `CircularDependencyError` (field `path`).
`DuplicateBindingError` gains a `reason` field. Every error builds its
message from its fields, as the 0.1 errors already do, so a message
reads the same wherever it is thrown. A `'dependency'` message ends with
its cause's message, so a chain two levels deep reads in one line:
`Could not resolve Transport for Newsletter: Could not resolve Mailer for
Transport: Token 'Mailer' is not bound. Available: none`.

`rebind` learns class abstracts. `rebind(Store, factory)` replaces the
binding of `Store` with a factory that receives an `InstanceProvider`,
the same shape `bindFactory` takes. It is how a test swaps a class
abstract for a double, since `bind` refuses a second binding. A token
`rebind` takes the same factory shape and passes the provider too, so a
loop through it is caught. A 0.1 factory with no argument still fits.

The 0.1 surface stays as it is: `bind(token, factory, singleton)`,
`rebind` of tokens, `has`, `getTokens`, string and typed tokens, and the
concurrency-safe singleton cache.

## Contract details the tests pin

Bindings:

- A `bind` call throws `DuplicateBindingError` and binds none of its
  abstracts when one of them is already bound (`reason` is `'bound'`),
  appears twice in the call (`'repeated'`), or was autowired by an
  earlier `get` (`'autowired'`). `bindFactory` throws the same error on
  the same conditions. The 0.1 form, the class form and `bindFactory`
  collide with each other in every order, because they share one key
  space.
- Refusing an autowired abstract keeps one instance per abstract. Without
  it, `get(Store)` before `bind(MemoryStore, Store)` would cache a hollow
  `Store`, because JavaScript can construct a TypeScript abstract class,
  and later gets would keep serving it. An autowire counts from the
  moment its `get` starts, and a class autowired as another class's
  `inject` entry counts too. An autowire that fails leaves no mark,
  whether the class was requested or reached as an entry, so the class
  can be bound after the failure.
- `get(Impl)` after `bind(Impl, Contract)` builds a separate `Impl`,
  because only the abstracts named in `bind` share an instance. This is
  PHPNomad's behavior. Name `Impl` in the call to share it.
- `has` is true only for an abstract that `bind` or `bindFactory` named.
  A class `get` autowired is not reported as bound.
- `rebind` changes only the key it names, a class or a token. When that
  key is one abstract of a class `bind`, the others keep the shared
  instance. A build of the old binding still in flight never touches the
  new one: a success does not overwrite it and a failure does not clear
  it. That holds for a `bindFactory` run too. Rebinding a class that
  `get` autowired replaces the autowired instance.

Caching and failure:

- Concurrent gets of two abstracts from one `bind` call build one
  instance. Concurrent gets of one factory binding run the factory once.
- No rejection is cached, at any level. After a failed build, the next
  `get` of any abstract of that binding, or of a class that needed it,
  tries again. Concurrent gets waiting on one failed run all get its
  error, and the run is not repeated for them.
- A retry runs the factory or constructor again from the start, so a
  side effect it made before it failed, such as a write or a request
  sent, happens again. Keep side effects out of factories and
  constructors, or key them so a second run finds the first one's
  result and stops, with the dedupe done atomically at the write.
- Errors from the requested binding's own constructor or factory pass
  through unchanged.
- A failure while resolving an `inject` entry becomes an `AutowireError`
  naming the class being built and the entry, with the failure as
  `cause` and `reason` `'dependency'`. Two levels down, the error is
  wrapped once per level, and each message ends with the message of the
  level below. A missing `inject` list gives `'no-inject'` and a short
  one `'short-inject'`.
- A constructor whose parameters all have defaults reports no
  parameters to JavaScript, so a class like that needs no `inject` list.
  Autowiring builds it with its defaults, as `new Counter()` would.

Loops:

- `inject` lists that form a loop reject with `CircularDependencyError`
  before any constructor in the loop runs. Its `path` reads
  `['Left', 'Right', 'Left']`, its `concrete` is `'Left'`, and the
  message carries the same path.
- A factory receives an `InstanceProvider`. While the factory runs, a
  `get` through it is part of the resolution in progress, so a loop that
  passes through a factory rejects with `CircularDependencyError` too.
  That covers a factory that gets its own abstract, a factory and an
  `inject` list that need each other, and concurrent gets that enter a
  loop at different abstracts, of classes or of factories.
- Concurrent gets that share a dependency with no loop, through `inject`
  lists or through factories, both wait for its one build. The loop
  check rejects only a real loop.
- A factory may keep its provider. Once the factory's run has settled, a
  `get` through the kept provider resolves as a top-level `get` would.
- A 0.1 factory takes no argument and calls the container it closes
  over, so its gets are outside the resolution. A loop through 0.1
  factories waits forever, as it did in 0.1, and every later `get` of an
  abstract in that loop waits too. 0.1 bindings can serve as `inject`
  entries now, so a class can reach such a loop. Moving those factories
  to `bindFactory` puts them inside the check, which is the fix.

## Where this differs from PHPNomad

- `get` returns a promise, because factories may be async.
- Autowiring reads `static inject`, not reflection. No decorators and no
  `reflect-metadata`, so consumers need no compiler flags.
- Binding an abstract twice throws instead of replacing the first
  binding, so a wiring mistake shows at startup. `rebind` replaces on
  purpose, for a class or a token.
- `bind` refuses a class that a `get` has already autowired, with the
  reason `'autowired'`. PHPNomad's `bind` replaces the binding and drops
  the cached instance, so later gets build the new concrete. Here an
  instance already handed out would go on living beside the new one, so
  the wiring mistake shows at the `bind` instead.
- PHPNomad keys an interface by its fully qualified class name. A token
  here carries the bare interface name, `'InstanceProvider'`,
  `'HasBindings'` and `'CanSetContainer'`, not the namespaced form design
  section 2 shows, such as `'tsnomad/event/EventStrategy'`. A typed token
  shares a binding with the string of its name, and `@tsnomad/loader`
  0.1 binds bare strings, so the bare name keeps 0.1 wiring working. Two
  packages that export interfaces with one name would share a key, so a
  new interface must not reuse a token name.
- The container detects loops and throws `CircularDependencyError`, a
  subclass of the new `AutowireError`. PHPNomad has neither. A PHP loop
  recurses until the stack overflows, which is loud. Here, the cache
  holds a pending promise for each build, so a loop would wait on its own
  promise forever without a sound. Detection turns that silent hang into
  an error that names the loop.
- A factory receives an `InstanceProvider`. A PHP factory takes no
  arguments and captures the container itself. The argument is what lets
  the container catch a loop through a factory.
- A failure in any `inject` entry is wrapped in `AutowireError`. PHP
  wraps only a `DiException` or a `ReflectionException` and lets other
  errors through. Wrapping every failure names the class chain that led
  to it.
- `get` of an abstract class nothing is bound to builds it, because
  TypeScript erases `abstract`. PHP refuses. A later `bind` of that class
  then throws, so the hollow instance is never mixed with a real one.
- The container does not check the resolved instance with `instanceof`.
  A structural fake for a class abstract, such as an object literal in a
  test, is normal TypeScript, and the compile-time check already ties a
  concrete to its abstracts.
- A parameter with a default value is not filled from its default when
  its `inject` entry cannot resolve. The list is explicit, so a missing
  binding is a wiring mistake. A class with no list whose parameters all
  have defaults builds with those defaults.
- PHPNomad keeps the container interfaces in `phpnomad/di` and the
  container in `phpnomad/di-container`. Here `InstanceProvider`,
  `HasBindings` and `CanSetContainer` live in this package beside the
  container, because TS Nomad's packages already depend on this one for
  tokens, and a second package would add an install for three
  interfaces.
- PHPNomad's `HasSettableContainer` trait has no counterpart here,
  because TypeScript has no traits and a base class would take the one
  `extends` a class has. A class implements `CanSetContainer` itself.
  `@tsnomad/loader` 0.1 exports its own `CanSetContainer`, typed
  `setContainer(container: Container): void`, and its `BaseInitializer`
  stands in for the trait. This one takes an `InstanceProvider` and
  returns `this`, as PHPNomad's does. The two names collide only for code
  that imports both, and the loader's slice moves it to this one.

## Files

| File | Role |
|---|---|
| `src/types.ts` | `Constructor`, `AbstractConstructor`, `Abstract`, `AnyAbstract`, `InjectEntry`, `InjectList`, `Injectable`, `AbstractType`, `BindableAbstracts`, `ContainerFactory` |
| `src/InstanceProvider.ts`, `src/HasBindings.ts`, `src/CanSetContainer.ts` | PHPNomad interfaces and their tokens |
| `src/errors.ts` | `DiException`, `ContainerError` alias, `DuplicateBindingError` with its reasons, `AutowireError`, `CircularDependencyError`, each building its message from its fields |
| `src/Container.ts` | `bind`, `bindFactory`, `rebind`, `get`, `has`, the class path from packet P1 and the review's fixes |
| `scripts/consumer-check.sh` | builds and tests consumers against exact commits |

## Acceptance tests

| File | Tests | What it proves |
|---|---|---|
| `test/bind-concrete.test.ts` | 20 | `bind` to tokens and classes, the shared instance, order of `inject` arguments, chaining, `has`, the duplicate rules, their reasons and messages, identity keys, string entries, 0.1 bindings as entries, a constructor error passing through, a failed shared build, `rebind` during a shared build that succeeds or fails, `rebind` of a class beside a sibling abstract, refusing an autowired abstract, also while in flight and as an entry, and binding a class after its autowire failed |
| `test/autowire-unbound.test.ts` | 6 | autowiring an unbound class, caching it, the separate instance for a concrete bound elsewhere, `has` staying false, retry after a failed build |
| `test/autowire-errors.test.ts` | 15 | each autowiring error, its reason and its message: missing and short `inject` lists, an inherited constructor, an inherited `inject` list that works, an unbound entry, wrapping two levels down with the whole chain in the message, a failing dependency constructor, retry after a failed dependency, loops, concurrent loops, a shared dependency that is no loop, loops through a token, an unbound typed token |
| `test/bind-factory.test.ts` | 16 | `bindFactory`: result, provider argument, one run under concurrency, one run for concurrent waiters on a failure, class abstracts, retry after rejection, chaining, the duplicate rules in every order, loops through factories, a shared dependency that is no loop, a kept provider, `rebind` during a run, the provider a token `rebind` passes |
| `test/autowire-type-safety.ts` | 14 rejected calls | compile-only: `inject` lists checked against constructors, concretes checked against abstracts, factory return types for `bindFactory` and a class `rebind`, inferred `get` types, the same checks through the interfaces |

That is 57 acceptance tests. P1 and the review added
`test/container-internals.test.ts`, 25 unit tests of the container's
own internals, and the 11 typed-token tests from the earlier work still
run. `npm test` builds and runs every file and reports 95, because it
also counts the two compile-only files as empty passes.
`npm run typecheck` checks the compile-only file. The runtime tests
import `dist`, as the typed-token tests already do.

## Proof

The record is in `docs/architecture/ncc-slice-6-proof/`: the two
harnesses, the mutation lists and their logs. It holds three sets. The
architecture phase's lists, described below, scored the tests against
a scratch implementation. The P1 implementer's list scored the real
code at the P1 head, 3c7566f: 83 entries, with one entry rerun on its
own after its first edit failed to build. The slice review's lists
scored the branch up to abdf281. The proof folder's README says how to
rerun each.

The architecture phase's proof ran as follows.

A scratch implementation in a separate clone passed all 57 runtime
tests and the 11 earlier typed-token tests. That clone is never
committed. Each guard then got its own mutation, and the harness scored
80 of them. Each built cleanly and turned the suite red, and the log
lists the tests each one failed. The run started with three controls: a break it must catch, a
comment it must not, and a syntax error it must refuse to score. The
harness refuses a mutation whose build fails, so a compile break never
counts as a kill.

Some guards need more than one edit to show. The loop checks are layered,
so a mutation that removes one layer leaves the loop caught by another.
The proof removes the layers together, and for the assertion that no
constructor in a loop runs, it builds the loop before throwing, so that
assertion is the one that fails. Each concurrency guard has a mutation
that breaks only the concurrent case, such as a cache that stores only
resolved values, and the loop check has one that rejects any nested get
of a build in flight, which only the shared-dependency tests catch.

The type harness loosened the signature behind each `@ts-expect-error`
line. Thirteen loosenings together left all 14 directives unused, each
exactly its expected ones, and caused no other error, with the same
three controls.

## Consumer check

The slice is done only when the five current consumers build and test
against the two branches. The consumer check script
(`scripts/consumer-check.sh`) does that in throwaway clones and never
pushes. It reads the consumer list from a file you pass it, because the
list names private repositories that do not belong in this public one.

In commit mode it points every `@tsnomad/di-container` and
`@tsnomad/event` at exact commits through package manager overrides.
After install it checks that each package has at least one installed
copy, that every copy is 0.2.0 and holds the same `src` files as its
pinned commit, wherever the copy sits, and that every lockfile entry
for either package resolves to its pinned commit. A file comparison
covers copies that a lockfile does not describe, such as one inside a
`file:` dependency. Each run gets its own folder, named after the mode
and the time, and records the commits it pinned. For each consumer it
records the test exit code, how many tests ran, each failing test with
the first line of its error, and vitest's unhandled errors. A malformed
row in the consumer list fails.

Compare mode applies the pass rule. It takes the consumer list, two or
more baseline runs and two or more check runs, all different folders.
It refuses any folder that is missing a listed consumer, ran another
commit, did not build, is the wrong kind of run, or pinned other commits
than the first check run. A consumer passes when all of these hold:

- No baseline failure is a timeout. A timeout hides the reason a test
  failed, so a row whose baseline timed out is rerun on a quieter
  machine before it can pass.
- No test fails in any check run that did not fail in a baseline. A
  failure in one check run counts, because a regression that fails only
  some of the time is still a regression.
- A test that failed in every baseline and fails again does so with the
  same first error line, and that line is known. Two consumers already
  fail tests on main, some of them through `Container.get` and
  `EventStrategy.broadcast`, so a failure that changes its reason counts
  as new. vitest prints one error under a group of failing tests, and
  each test in the group gets that line.
- No check run exits non-zero without naming a failing test, unless
  every baseline did the same.
- No check run ran fewer tests than the smallest baseline.
- No check run has more unhandled errors than the largest baseline, or
  an unhandled error line no baseline had.

A test that failed in some baselines and not others is listed as flaky
by name, and only those tests are excused. A consumer whose baseline
runs no tests is marked build-only. The report also calls a consumer
build-only when its tests never load either package. That consumer's
test command runs its built binary once, so its wiring runs on the new
code. Run everything on a quiet
machine, one consumer at a time, because timeouts under load look like
failures.

A consumer that stops compiling because of the event package's 0.2.0
breaks gets a fix patch. The patch applies only the fixes listed in the
event note, and the report names each one. A consumer that reaches the
event package through another consumer, such as a worker built on the
worker SDK at a pinned commit, needs that dependency fixed too. The
consumer list's optional seventh column pins it to a throwaway clone of
that commit with the same fix patch applied and built, through a `file:`
spec.
