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

The slice 6 review added two lists that target this branch's own code,
so anyone can rerun them here:

```
python3 docs/architecture/ncc-slice-6-proof/mutate.py . docs/architecture/ncc-slice-6-proof/review-mutations.py
python3 docs/architecture/ncc-slice-6-proof/mutate.py . docs/architecture/ncc-slice-6-proof/review-fix-mutations.py
```

`review-mutations.py` is a spot check of the P1 class path, R1 to R6.
The brief capped it at ten mutations, so it samples the guards and does
not cover each one. `review-fix-mutations.py` proves the unit tests the
review added with its fixes, one mutation per guard: the 0.1 `bind`
reading an explicit `undefined` singleton flag as a singleton, and the
constructor reader in `src/classSource.ts`. Each log sits beside its
list.

The reader has one guard with no mutation that changes a result. A `}`
nested inside a template's `${}` part is counted so the part closes at
the right brace, but every case tried closes the template at the same
place either way, because the text between the two braces is template
text.

The P1 implementer's full list of 83 mutations is not in this folder.
Its log is pasted in the P1 comment on the pull request.
