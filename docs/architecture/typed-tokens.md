# Typed tokens

Status: architecture phase one, incomplete by design. The acceptance tests
below are marked `skip` and the container's typed-token code paths are
stubs. This is milestone one of
[Seat scripts on the TSNomad kernel: architecture note (Source 9714)](https://navigator.novatori.us/r/source/9714):
"Typed tokens in @tsnomad/di-container, so a binding's type is inferred
rather than asserted."

## The problem this fixes

Today a binding lives under a plain string token, `'Logger'`, and
`container.get<T>('Logger')` hands back whatever `T` the caller writes at
the call site. Nothing checks that `T` against what the factory actually
returns. The generic argument is a cast, not a check. A factory that
returns the wrong shape compiles and fails only when something later tries
to use the value.

## The shape of the change

A new kind of token, `TypedToken<T>`, carries its bound type as part of
its own type. A plain string still works exactly as it does today, for at
least one more minor version, so nothing that already calls `bind`,
`rebind`, `get`, or `has` with a string needs to change.

`createToken<T>(name)` builds a `TypedToken<T>`. At runtime it is a small
object holding just the name, the same name a string token would use. The
type parameter `T` never exists as a runtime value. It lives only in the
type system, attached through a private, unexported symbol key so it
never shows up when a token is logged, compared, or serialized. Two
tokens with the same name, one typed and one a plain string, are the same
binding, the same way two string tokens with the same text already are.

`Container.bind`, `Container.rebind`, `Container.get`, and `Container.has`
each grow a second, typed overload above the existing string overload.
When the caller passes a `TypedToken<T>`, TypeScript checks the factory
against `T` at `bind` and `rebind`, and infers `T` at `get` and `has` with
no generic argument written at the call site. When the caller passes a
plain string, the existing string overload still applies and nothing
about its behavior changes.

No new error type is needed. `DuplicateBindingError` already names the
token that was bound twice. Once typed-token binding is implemented, a
duplicate typed token throws the same `DuplicateBindingError`, built from
the token's name, so the message reads the same as it does for a string
token today.

## Public surface

```ts
// types.ts
export type Token = string;
export interface TypedToken<T> {
  readonly name: string;
  // phantom, keyed by a private symbol, never set at runtime
}
export type AnyToken<T> = Token | TypedToken<T>;

// createToken.ts
export function createToken<T>(name: string): TypedToken<T>;

// Container.ts
class Container {
  bind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  bind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;

  rebind<T>(token: TypedToken<T>, factory: Factory<T>, singleton?: boolean): void;
  rebind<T>(token: Token, factory: Factory<T>, singleton?: boolean): void;

  get<T>(token: TypedToken<T>): Promise<T>;
  get<T>(token: Token): Promise<T>;

  has<T>(token: TypedToken<T>): boolean;
  has(token: Token): boolean;
}
```

`errors.ts` is untouched. `DuplicateBindingError` and `BindingNotFoundError`
are reused as they stand.

## Relationships and names

`createToken` lives in its own file, `src/createToken.ts`, next to
`Container.ts`, `types.ts`, and `errors.ts`, matching the one-file-per-role
layout this package already uses. `TypedToken` and `AnyToken` join `Token`,
`Factory`, and `Binding` in `types.ts`, since they are types the whole
package shares, not behavior that belongs to one class.

`Container` gains no new fields and no new dependency. The class still
owns exactly two maps, `bindings` and `instances`, both still keyed by a
plain string. A typed token's name becomes that string key. `bind`,
`rebind`, `get`, and `has` are the only members that change, because they
are the only members that take a token as an argument.

This follows PHPNomad's container in shape. PHPNomad users already read a
token as a name that stands for an interface. A typed token here is that
same name, carrying its own type so the container can check it.

## What is stubbed and why

Per the architecture phase contract, a stub returns a valid hardcoded
value of its declared type and never throws. The string-token path in
`bind`, `rebind`, `get`, and `has` is untouched, because that behavior
already exists and this packet does not change it. The typed-token path
in each of those four methods is new, and its body is a placeholder:

- `bind` and `rebind` return without storing anything.
- `get` returns `undefined` cast to the declared type.
- `has` returns `false`.

`createToken` itself has no branch to defer. Building a `{ name }` object
is the whole of it, so its committed body is already its final shape.

The overload signatures on `bind`, `rebind`, `get`, and `has` are not
stubbed. A parameter type is part of the surface the architecture phase
owns outright, per the contract's list of what a stub carries: signatures,
parameter types, and return types. That is why the compile-time check
below already holds today, before any implementer touches the container.

## Acceptance tests

Five files live under `test/`, one node's test runner already discovers
by folder convention:

- `test/typed-token-bind-resolve.test.ts`, a typed token binds and
  resolves with the inferred type.
- `test/typed-token-string-compat.test.ts`, a string token still works.
- `test/typed-token-duplicate.test.ts`, binding a typed token twice
  throws `DuplicateBindingError` naming the token.
- `test/typed-token-async-singleton.test.ts`, async factories and
  singleton caching hold for typed tokens.
- `test/typed-token-type-safety.ts`, a compile-only check with no
  `test()` call. `npm run typecheck` covers it, using a
  `// @ts-expect-error` line to prove a factory whose return type does
  not match the token's type fails to compile.

The first four are marked `test.skip`, the language's own incomplete
marker for node's test runner. They stay skipped, not failing, so
`npm test` is green on the committed state. The fifth carries no marker,
because what it checks, the typed overload's parameter types, is already
finished, not deferred.

`npm run typecheck` builds the package first, then type-checks `src` and
`test` together, so the compile-only file's `@ts-expect-error` is
evaluated against the same code the acceptance tests import. `npm test`
also builds first, then runs `node --test`, importing the built `dist`
output the same way a consumer of the published package would.

## Proof

Each acceptance test was proven runnable and falsifiable per
[Proving a Test Is a Contract (KB 730)](https://navigator.novatori.us/r/kb/730):
remove the marker, implement the stub just far enough to pass, confirm it
passes, delete the behavior, confirm it fails for the intended reason,
throw away the scratch implementation, and restore the marker. Command
output below is trimmed to the relevant lines. `Container.ts` was
byte-for-byte diffed against its committed state after every restore, and
it matched every time.

### a typed token binds and resolves with the inferred type

Implemented `bind` and `get` to key both maps off `typeof token === 'string' ? token : token.name`.

```
✔ a typed token binds and resolves with the inferred type (1.212646ms)
ℹ pass 1
ℹ fail 0
```

Deleted the behavior by reverting `get`'s typed branch to its stub
(`return undefined as unknown as T`), leaving `bind` implemented:

```
✖ a typed token binds and resolves with the inferred type (0.513087ms)
  TypeError: Cannot read properties of undefined (reading 'log')
      at TestContext.<anonymous> (test/typed-token-bind-resolve.test.ts:30:10)
```

Failed because `get` handed back `undefined` again instead of the bound
logger, the exact property this test guards. Scratch implementation
discarded, `Container.ts` restored, marker restored.

### a string token still works

Removed the marker with the string path untouched, no implementation
step needed since this test guards existing behavior, not new behavior:

```
✔ a string token still works (0.487182ms)
ℹ pass 1
ℹ fail 0
```

Deleted the behavior by replacing `bind`'s body with a no-op:

```
✖ a string token still works (0.526073ms)
  Error [BindingNotFoundError]: Token 'Greeting' is not bound. Available: none
      at Container.get (dist/Container.js:56:19)
```

Failed because nothing was ever stored, so `get` could not find the
binding, the exact property this test guards. Scratch implementation
discarded, `Container.ts` restored, marker restored.

### binding a typed token twice throws a DuplicateBindingError naming the token

Implemented `bind` to key off the token's name and keep the existing
duplicate check:

```
✔ binding a typed token twice throws a DuplicateBindingError naming the token (0.618331ms)
ℹ pass 1
ℹ fail 0
```

Deleted the behavior by removing the duplicate check, keeping the key
normalization:

```
✖ binding a typed token twice throws a DuplicateBindingError naming the token (0.790491ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.
      at test/typed-token-duplicate.test.ts:19:10
```

Failed because the second bind silently replaced the first instead of
throwing, the exact property this test guards. Scratch implementation
discarded, `Container.ts` restored, marker restored.

### async factories and singleton caching hold for typed tokens

Implemented `bind` and `get` with the same key normalization as the first
test:

```
✔ async factories and singleton caching hold for typed tokens (0.510415ms)
ℹ pass 1
ℹ fail 0
```

Deleted the behavior by removing the singleton cache read and write from
`get`, leaving the key normalization and the binding lookup:

```
✖ async factories and singleton caching hold for typed tokens (0.934771ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  2 !== 1
      at test/typed-token-async-singleton.test.ts:33:10
```

Failed because the factory ran twice instead of once, the exact property
this test guards. Scratch implementation discarded, `Container.ts`
restored, marker restored.

### a wrong factory type fails to compile

This one has no runtime marker, so it was proven by mutating the type
signature instead of the test body. `bind`'s typed overload was widened
from `factory: Factory<T>` to `factory: Factory<unknown>`:

```
test/typed-token-type-safety.ts(28,1): error TS2578: Unused '@ts-expect-error' directive.
```

Failed to typecheck because the widened overload no longer rejects a
factory returning the wrong type, so the suppressed error never fires and
the unused directive itself becomes the error, the exact property this
check guards. The overload was restored to `factory: Factory<T>`, and
`npm run typecheck` passed clean again.

## What I could not do

I did not run this packet's architecture through `/pr-audit` before
opening the pull request, since that step calls a review-lens fleet this
delivery did not have access to. The draft pull request is open for that
review to happen before any implementer claims a packet.
