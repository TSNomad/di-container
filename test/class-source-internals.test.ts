/**
 * Unit tests for `ownConstructor`, the source reader the container uses
 * to tell whether a class with `length` 0 declares a constructor of its
 * own or inherits one. Added in the slice 6 review.
 *
 * These are scaffolding per the implementation phase contract, not the
 * acceptance criterion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownConstructor } from '../dist/classSource.js';
import { Container } from '../dist/Container.js';
import { AutowireError } from '../dist/errors.js';

test('a class with no constructor reads as none', () => {
  assert.equal(ownConstructor('class A extends B { m() { return 1; } }'), 'none');
});

test('a constructor that calls super with its own arguments reads as declared', () => {
  assert.equal(ownConstructor('class A extends B { constructor() { super(1); } }'), 'declared');
});

test('a line comment in the class body that mentions constructor( does not count', () => {
  assert.equal(ownConstructor('class A extends B {\n  // constructor(value)\n  m() {}\n}'), 'none');
});

test('a block comment in the class body that mentions constructor( does not count', () => {
  assert.equal(ownConstructor('class A extends B { x = 1 /* constructor( */; }'), 'none');
});

test('a single-quoted string field that mentions constructor( does not count', () => {
  assert.equal(ownConstructor("class A extends B { s = 'constructor('; }"), 'none');
});

test('a double-quoted string field that mentions constructor( does not count', () => {
  assert.equal(ownConstructor('class A extends B { s = "constructor("; }'), 'none');
});

test('an escaped quote inside a string does not end it', () => {
  const source = "class A extends B { s = 'it\\'s'; t = 'constructor('; }";
  assert.equal(ownConstructor(source), 'none');
});

test('a template literal field that mentions constructor( does not count', () => {
  assert.equal(ownConstructor('class A extends B { s = `constructor(`; }'), 'none');
});

test('a nested template inside a template part does not count', () => {
  const source = 'class A extends B { s = `outer ${`constructor(${1})`} end`; }';
  assert.equal(ownConstructor(source), 'none');
});

test('a backtick inside a string inside a template part does not end the template', () => {
  const source = "class A extends B { x = `${'`'}`; constructor() { super(1); } }";
  assert.equal(ownConstructor(source), 'declared');
});

test('a regular expression after an operator that holds a quote does not open a string', () => {
  const source = "class A extends B { q = /'/; s = 'constructor('; }";
  assert.equal(ownConstructor(source), 'none');
});

test('a regular expression after a keyword that holds a quote does not open a string', () => {
  const source = "class A extends B { q = typeof /'/; s = 'constructor('; }";
  assert.equal(ownConstructor(source), 'none');
});

test('a slash inside a character class does not end a regular expression', () => {
  const source = "class A extends B { q = /[/]'/; s = 'constructor('; }";
  assert.equal(ownConstructor(source), 'none');
});

test('a division is not read as a regular expression', () => {
  const source = 'class A extends B { m = this.a / 2; constructor() { super(1); } }';
  assert.equal(ownConstructor(source), 'declared');
});

test('a constructor inside a nested class does not count', () => {
  const source = 'class A extends B { m() { return class { constructor(x) {} }; } }';
  assert.equal(ownConstructor(source), 'none');
});

test('an object literal method named constructor does not count', () => {
  assert.equal(ownConstructor('class A extends B { opts = { constructor() {} }; }'), 'none');
});

test('a static method named constructor does not count', () => {
  assert.equal(ownConstructor('class A extends B { static constructor() { return 1; } }'), 'none');
});

test('a constructor inside the extends clause does not count', () => {
  const source = 'class A extends mix({ constructor() {} }) { m() {} }';
  assert.equal(ownConstructor(source), 'none');
});

test('a constructor that only forwards arguments to super reads as a pass-through', () => {
  const source = 'class A extends B { constructor() { super(...arguments); this.x = 1; } }';
  assert.equal(ownConstructor(source), 'pass-through');
});

test('a constructor that forwards a rest parameter to super reads as a pass-through', () => {
  const source = 'class A extends B { constructor(...args) { super(...args); this.x = 1; } }';
  assert.equal(ownConstructor(source), 'pass-through');
});

test('a constructor that spreads something other than its own rest parameter is declared', () => {
  const source = 'class A extends B { constructor(...args) { super(...other); } }';
  assert.equal(ownConstructor(source), 'declared');
});

test('a constructor whose parameters hold parentheses is declared, never a pass-through', () => {
  const source = 'class A extends B { constructor(a = f()) { super(...arguments); } }';
  assert.equal(ownConstructor(source), 'declared');
});

test('a class compiled for an older target, with its fields moved into a forwarding constructor, still needs an inject list', async () => {
  class Base {
    readonly value: unknown;
    constructor(value: unknown) {
      this.value = value;
    }
  }
  // What tsc and esbuild write for `class Lowered extends Base { extra = 1; }`
  // below ES2022 or with useDefineForClassFields off.
  const Lowered = new Function(
    'Base',
    'return class Lowered extends Base { constructor() { super(...arguments); this.extra = 1; } };'
  )(Base) as new () => Base;
  const container = new Container();

  await assert.rejects(
    () => container.get(Lowered),
    (error: unknown) => error instanceof AutowireError && error.concrete === 'Lowered' && error.reason === 'no-inject'
  );
});
