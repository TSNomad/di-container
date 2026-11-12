# Slice 6 proof record

This folder holds the evidence that each acceptance test is a contract,
as the Proof section of `../ncc-slice-6.md` describes.

- `mutate.py` runs the suite once per mutation in `mutations.py` and
  writes `mutations.log`. A mutation counts as caught when the suite
  exits non-zero, and each entry names the guard it breaks and lists the
  tests that went red. It runs `node --test --test-timeout=20000` rather
  than `npm test`, so a mutation that makes a test hang fails that test
  instead of stalling the run.
- `types-mutate.py` does the same for the compile-only type test, from
  `type-mutations.py` into `type-mutations.log`, and reports which
  `@ts-expect-error` lines each loosening left unused.

The mutations target a scratch implementation in a separate clone that
is never committed, so they do not apply to this branch. Each run
starts with three controls: a break the harness must catch, a comment it
must not, and a syntax error it must refuse to score.
