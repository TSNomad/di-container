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

## Review spot check at the PR head

`review-mutations.py` and `review-mutations.log` come from the slice 6
review. Unlike the lists above, they target this branch's own code, so
anyone can rerun them here:

```
python3 docs/architecture/ncc-slice-6-proof/mutate.py . docs/architecture/ncc-slice-6-proof/review-mutations.py
```

The brief capped the review at ten mutations, so the list samples the
implementation and does not cover every guard. R1 to R7 break guards in
the P1 class path. F1 to F4 prove the unit tests the review added with
its two fixes, the 0.1 `bind` reading an explicit `undefined` singleton
flag as a singleton, and the constructor check ignoring comments and
string literals. The P1 implementer's full list of 83 mutations is not
in this folder. Its log is pasted in the P1 comment on the pull request.
