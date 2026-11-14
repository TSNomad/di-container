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

`mutations.py`, `type-mutations.py` and their logs come from the
architecture phase. They target a scratch implementation in a separate
clone that is never committed, so they do not apply to this branch. Each run
starts with three controls: a break the harness must catch, a comment it
must not, and a syntax error it must refuse to score.

## Review spot check at the PR head

The slice 6 review added two lists that target this branch's own code,
so anyone can rerun them here:

```
python3 docs/architecture/ncc-slice-6-proof/mutate.py . docs/architecture/ncc-slice-6-proof/review-mutations.py
python3 docs/architecture/ncc-slice-6-proof/mutate.py . docs/architecture/ncc-slice-6-proof/review-fix-mutations.py
```

`review-mutations.py` is a spot check of the P1 class path, R1 to R5.
The brief capped it at ten mutations, so it samples the guards and does
not cover each one. `review-fix-mutations.py` proves the unit tests the
review added with its fixes, one mutation per guard: the 0.1 `bind`
reading an explicit `undefined` singleton flag as a singleton, and the
rule that the parameter walk never stops at a constructor with no
parameters, except at a class that declares an empty `inject` list. Each log
sits beside its list.

## Packet P1 list

`p1-mutations.py` and `p1-mutations.log` are the P1 implementer's full
list, 83 entries with the three controls, run against the P1 head,
3c7566f. One entry, M11, was refused because its edit did not build,
so the log ends with one mismatch. `p1-mutations-m11.py` reruns M11
with a building edit, with the three controls, and its log shows it
caught. Two entries, S5 and U13, are marked as understood survivors:
they change nothing a caller can see. The list targets the code at
3c7566f, so rerun it from a checkout of that commit. The review's own
lists above cover the later heads, up to abdf281.

## Lane s06-b fixes

`s06-b-mutations.py` and its log prove the unit tests for three findings
the review left open: a value that is no abstract throws `DiException`,
a `'dependency'` message names a cause that is not an Error, and a class
`bind` with no abstract throws. It holds one mutation per guard and the
three controls, and targets this branch:

```
python3 docs/architecture/ncc-slice-6-proof/mutate.py . docs/architecture/ncc-slice-6-proof/s06-b-mutations.py
```
