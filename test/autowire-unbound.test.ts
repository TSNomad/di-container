/**
 * Acceptance tests: `get` autowires a class nothing is bound to, as
 * PHPNomad's container does. See docs/architecture/ncc-slice-6.md.
 *
 * Marked `test.skip` while the container's class path is a stub.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../dist/Container.js';
import { createToken } from '../dist/createToken.js';

interface Clock {
  now(): number;
}
const Clock = createToken<Clock>('Clock');

class FixedClock implements Clock {
  now(): number {
    return 42;
  }
}

class Plain {
  static built = 0;
  constructor() {
    Plain.built += 1;
  }
}

class Stamp {
  static readonly inject = [Clock, Plain] as const;
  readonly clock: Clock;
  readonly plain: Plain;
  constructor(clock: Clock, plain: Plain) {
    this.clock = clock;
    this.plain = plain;
  }
}

test('a class with no constructor parameters and no inject list builds with new', async () => {
  const container = new Container();

  const plain = await container.get(Plain);

  assert.ok(plain instanceof Plain);
});

test('an unbound class is autowired from its inject list', async () => {
  const container = new Container();
  container.bind(FixedClock, Clock);

  const stamp = await container.get(Stamp);

  assert.ok(stamp instanceof Stamp);
  assert.equal(stamp.clock.now(), 42, 'the Clock argument comes from the Clock binding');
  assert.ok(stamp.plain instanceof Plain, 'an unbound class argument is autowired in turn');
});

test('an autowired class is cached like a bound one', async () => {
  Plain.built = 0;
  const container = new Container();

  const first = await container.get(Plain);
  const second = await container.get(Plain);
  const [third, fourth] = await Promise.all([container.get(Plain), container.get(Plain)]);

  assert.equal(Plain.built, 1);
  assert.equal(first, second);
  assert.equal(first, third);
  assert.equal(first, fourth);
});

test('get of a concrete that is bound only under another abstract builds its own instance', async () => {
  const container = new Container();
  container.bind(FixedClock, Clock);

  const viaToken = await container.get(Clock);
  const viaClass = await container.get(FixedClock);

  assert.ok(viaClass instanceof FixedClock);
  assert.notEqual(viaToken, viaClass, 'only the abstracts named in bind share the instance');
});

test('an autowired class is not reported by has', async () => {
  const container = new Container();
  const plain = await container.get(Plain);

  assert.ok(plain instanceof Plain, 'get autowired the class');
  assert.equal(container.has(Plain), false);
});

test('a failed autowired build leaves nothing cached, so a later get builds again', async () => {
  let attempts = 0;
  class Flaky {
    readonly attempt: number;
    constructor() {
      attempts += 1;
      if (attempts === 1) {
        throw new RangeError('first build fails');
      }
      this.attempt = attempts;
    }
  }
  const container = new Container();

  await assert.rejects(() => container.get(Flaky), RangeError);
  const second = await container.get(Flaky);

  assert.equal(second.attempt, 2);
  assert.equal(await container.get(Flaky), second, 'the successful build is cached');
});
