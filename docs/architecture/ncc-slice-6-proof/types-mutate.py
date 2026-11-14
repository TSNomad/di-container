#!/usr/bin/env python3
"""Mutation harness for the compile-only type tests of slice 6.

Usage: types-mutate.py <repo-dir> <type-test-file> <mutations.py>

Each mutation is (id, file, find, replace, expect). `expect` is a list of
substrings, one per `@ts-expect-error` comment the mutation must leave
unused, or 'survive' (control: typecheck must stay clean) or 'refuse'
(control: the change must break the build, so it is not scored).
A list of (find, replace) pairs may stand in for `find`, with None as
`replace`.

It runs `npm run typecheck`, which builds first. A mutation counts as
killed only when the typecheck reports TS2578 (unused directive) at
exactly the expected directives and reports no other error. Any other
error means the mutation broke something else, and it is refused.
"""
import subprocess, sys, re, runpy, pathlib

repo = pathlib.Path(sys.argv[1])
typefile = sys.argv[2]
mutations = runpy.run_path(sys.argv[3])['MUTATIONS']

def typecheck():
    r = subprocess.run('npm run typecheck', cwd=repo, shell=True, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    errors = re.findall(r'^(\S+?)\((\d+),\d+\): error (TS\d+)', out, re.M)
    return r.returncode, errors, out

lines = (repo / typefile).read_text().splitlines()
directives = {i + 1: l.split('@ts-expect-error', 1)[1].strip() for i, l in enumerate(lines) if l.strip().startswith('// @ts-expect-error')}

rc, errors, out = typecheck()
print(f'baseline typecheck exit={rc} errors={len(errors)} directives={len(directives)}')
if rc != 0:
    print(out[-2000:]); sys.exit(2)

bad = 0
hit = set()
for mid, rel, find, repl, expect in mutations:
    path = repo / rel
    original = path.read_text()
    pairs = find if isinstance(find, list) else [(find, repl)]
    if any(original.count(f) != 1 for f, _ in pairs):
        print(f'{mid}: REFUSED (find text not present exactly once)  expect={expect}')
        if expect != 'refuse': bad += 1
        continue
    mutated = original
    for f, r in pairs:
        mutated = mutated.replace(f, r)
    path.write_text(mutated)
    try:
        rc, errors, out = typecheck()
        unused = sorted(int(l) for f, l, code in errors if code == 'TS2578' and f.endswith(typefile))
        other = [(f, l, code) for f, l, code in errors if not (code == 'TS2578' and f.endswith(typefile))]
        if other or (rc != 0 and not unused):
            print(f'{mid}: REFUSED (other errors: {other[:2]})  expect={expect}')
            if expect != 'refuse': bad += 1
            continue
        if expect == 'survive':
            ok = rc == 0
            print(f'{mid}: {"SURVIVED" if rc == 0 else "KILLED"} expect=survive {"OK" if ok else "MISMATCH"}')
        elif expect == 'refuse':
            ok = False
            print(f'{mid}: NOT REFUSED expect=refuse MISMATCH')
        else:
            got = [directives.get(l, f'line {l}?') for l in unused]
            want_lines = sorted(l for l, text in directives.items() if any(e in text for e in expect))
            ok = unused == want_lines and len(want_lines) == len(expect)
            hit.update(unused)
            print(f'{mid}: KILLED unused={unused} expect={want_lines} {"OK" if ok else "MISMATCH"}')
            for g in got:
                print(f'    unused: {g}')
        if not ok: bad += 1
    finally:
        path.write_text(original)
        assert path.read_text() == original

rc, errors, _ = typecheck()
print(f'restored typecheck exit={rc}')
missed = [f'{l}: {t}' for l, t in directives.items() if l not in hit]
print(f'directives never left unused: {missed if missed else "none"}')
print(f'mismatches={bad}')
sys.exit(1 if bad or missed else 0)
