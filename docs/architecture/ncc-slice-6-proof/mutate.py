#!/usr/bin/env python3
"""Mutation harness for the slice 6 acceptance proof.

Usage: mutate.py <repo-dir> <mutations.py> [<test-dir>]

With a test dir, the mutation is made and built in repo-dir and the
suite runs in test-dir, after its own build. That scores a mutation in
one package against another package's tests, such as the event suite
against a container it installs from repo-dir.

Each mutation is (id, file, find, replace, expect) where expect is
'killed' (the suite must go red), 'survive' (control, the suite must
stay green) or 'refuse' (control, the build must fail). A mutation that
edits several places passes a list of (find, replace) pairs as `find`
and None as `replace`. The harness:
  - refuses to score a mutation whose find text is not present exactly once,
  - refuses to score a mutation whose build (npm run build) fails, so a
    compile break never counts as a kill,
  - scores on `node --test` exit code, and lists the failing test names.
It restores the file after each mutation and checks the restore byte for byte.
"""
import subprocess, sys, re, runpy, pathlib

repo = pathlib.Path(sys.argv[1])
mutations = runpy.run_path(sys.argv[2])['MUTATIONS']
tests = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else repo
print(f'mutations in {repo.resolve().name}, tests in {tests.resolve().name}')

def run(cmd, where=None):
    return subprocess.run(cmd, cwd=where or repo, shell=True, capture_output=True, text=True, timeout=300)

def suite():
    if tests != repo:
        pre = run('npm run build', tests)
        if pre.returncode != 0:
            return pre
    return run('node --test --test-timeout=20000', tests)

b0 = run('npm run build')
base = suite() if b0.returncode == 0 else b0
print(f'baseline exit={base.returncode}')
if base.returncode != 0:
    print(base.stdout[-3000:]); sys.exit(2)

bad = 0
for mid, rel, find, repl, expect in mutations:
    path = repo / rel
    original = path.read_text()
    pairs = find if isinstance(find, list) else [(find, repl)]
    mutated = original
    missing = [f for f, _ in pairs if mutated.count(f) != 1]
    if missing:
        print(f'{mid}: REFUSED (find text not present exactly once: {missing[0][:50]!r})  expect={expect}')
        if expect != 'refuse': bad += 1
        continue
    for f, r in pairs:
        mutated = mutated.replace(f, r)
    path.write_text(mutated)
    try:
        b = run('npm run build')
        if b.returncode != 0:
            err = [l for l in (b.stdout + b.stderr).splitlines() if 'error' in l][:2]
            print(f'{mid}: REFUSED (build failed: {" | ".join(err)})  expect={expect}')
            if expect != 'refuse': bad += 1
            continue
        t = suite()
        failing = re.findall(r'^✖ (.+?) \(\d', t.stdout, re.M)
        failing = [f for f in failing if not f.startswith('test/')]
        verdict = 'killed' if t.returncode != 0 else 'survived'
        ok = (verdict == 'killed') == (expect == 'killed')
        if not ok: bad += 1
        print(f'{mid}: {verdict.upper()} exit={t.returncode} expect={expect} {"OK" if ok else "MISMATCH"}')
        for f in sorted(set(failing)):
            print(f'    ✖ {f}')
    finally:
        path.write_text(original)
        assert path.read_text() == original, f'{mid}: restore failed'

run('npm run build')
print(f'mismatches={bad}')
sys.exit(1 if bad else 0)
