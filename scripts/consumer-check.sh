#!/usr/bin/env bash
# Builds and tests TS Nomad consumers against exact di-container and event
# commits, and compares the results with a baseline run.
#
# Usage:
#   scripts/consumer-check.sh <consumers.tsv> baseline
#   scripts/consumer-check.sh <consumers.tsv> <di-container-sha> <event-sha>
#   scripts/consumer-check.sh compare <baseline-dir>[,<baseline-dir>...] <run-dir>[,<run-dir>...]
#
# consumers.tsv has one consumer per line, tab separated, '#' for comments:
#   name  clone-url  subdir  manager(npm|pnpm)  build-command  test-command  [extra-overrides]
# The test command must be the consumer's real test command, not a no-op.
# extra-overrides is optional: comma separated package=spec pairs that
# commit mode also pins, such as a dependency that itself needs the
# 0.2.0 fixes and is built from a throwaway clone with a file: spec.
#
# Each consumer gets a fresh shallow clone under $CONSUMER_CHECK_DIR
# (default: $TMPDIR/tsnomad-consumers), in a folder named after the mode.
# Baseline mode changes nothing in the clone.
#
# Commit mode points every @tsnomad/di-container and @tsnomad/event in the
# tree at the given commits, direct or transitive, through the package
# manager's overrides. If $CONSUMER_CHECK_FIXES names a folder holding
# <consumer>.patch, that patch is applied to the clone before install. A
# fix patch carries only the documented 0.2.0 migration fixes. After
# install, the script checks that each package has at least one installed
# copy, that every copy is 0.2.0, and that every lockfile entry for either
# package resolves to its pinned commit. A consumer whose pins do not hold
# fails, so a green row always means the new code ran.
#
# Tests run only when the build passed. Next to the logs, each consumer
# gets <consumer>.mode, .commit, .pins, .built, .test-rc, .tests (the
# number of tests vitest ran), .failures (failing test names, from
# vitest's FAIL lines) and .failure-messages (each failing test with the
# first line of its error).
#
# Compare mode takes one or more baseline folders and one or more run
# folders, comma separated. Every folder must hold every consumer, at the
# same commit, built, with a test exit code. Run folders must come from
# commit mode with pins ok. A test counts as failing in the baseline when
# it failed in any baseline folder, and one that failed in some baseline
# folders but not all is listed as flaky. A consumer passes when:
#   - no test fails in any run folder that did not fail in the baseline,
#   - no test that fails in every baseline folder fails in a run with a
#     different first error line,
#   - no run exits non-zero without naming a failing test, unless every
#     baseline did the same,
#   - no run ran fewer tests than the smallest baseline.
# A consumer whose baseline ran no tests is marked build-only. A baseline
# failure that passes in every run is reported and does not count against
# the consumer.
#
# The script never commits or pushes in a clone. It exits 1 when any row
# failed, 0 when all passed.

set -u -o pipefail

if [ "${1:-}" = "compare" ]; then
  IFS=',' read -r -a bases <<<"${2:?baseline run folder required}"
  IFS=',' read -r -a runs <<<"${3:?run folder required}"
  failed=0
  echo "| consumer | checks | tests base/run | new failures | changed errors | flaky in baseline | no longer failing | verdict |"
  echo "|---|---|---|---|---|---|---|---|"
  for commit_file in "${bases[0]}"/*.commit; do
    name="$(basename "$commit_file" .commit)"
    commit="$(cat "$commit_file")"
    problems=""
    for dir in "${bases[@]}" "${runs[@]}"; do
      for part in commit built test-rc tests failures failure-messages mode; do
        [ -f "$dir/$name.$part" ] || problems="$problems $dir lacks $part;"
      done
      [ "$(cat "$dir/$name.commit" 2>/dev/null)" = "$commit" ] || problems="$problems $dir commit differs;"
      [ "$(cat "$dir/$name.built" 2>/dev/null)" = "yes" ] || problems="$problems $dir not built;"
    done
    for dir in "${bases[@]}"; do
      [ "$(cat "$dir/$name.mode" 2>/dev/null)" = "baseline" ] || problems="$problems $dir is not a baseline;"
    done
    for dir in "${runs[@]}"; do
      [ "$(cat "$dir/$name.mode" 2>/dev/null)" = "check" ] || problems="$problems $dir is not a commit-mode run;"
      [ "$(cat "$dir/$name.pins" 2>/dev/null)" = "ok" ] || problems="$problems $dir pins not ok;"
    done
    if [ -n "$problems" ]; then
      echo "| $name |$problems | - | - | - | - | - | fail |"
      failed=1
      continue
    fi

    base_any="$(for d in "${bases[@]}"; do cat "$d/$name.failures"; done | sed '/^$/d' | sort -u)"
    base_all="$(for d in "${bases[@]}"; do sort -u "$d/$name.failures"; done | sed '/^$/d' | sort | uniq -c \
      | awk -v n="${#bases[@]}" '$1 == n { $1 = ""; sub(/^ /, ""); print }')"
    flaky="$(comm -23 <(printf '%s\n' "$base_any" | sed '/^$/d') <(printf '%s\n' "$base_all" | sed '/^$/d'))"
    run_any="$(for d in "${runs[@]}"; do cat "$d/$name.failures"; done | sed '/^$/d' | sort -u)"
    run_all="$(for d in "${runs[@]}"; do sort -u "$d/$name.failures"; done | sed '/^$/d' | sort | uniq -c \
      | awk -v n="${#runs[@]}" '$1 == n { $1 = ""; sub(/^ /, ""); print }')"
    new="$(comm -13 <(printf '%s\n' "$base_any" | sed '/^$/d') <(printf '%s\n' "$run_any" | sed '/^$/d'))"
    gone="$(comm -23 <(printf '%s\n' "$base_any" | sed '/^$/d') <(printf '%s\n' "$run_any" | sed '/^$/d'))"
    # Tests failing in every baseline and in a run: compare first error lines.
    changed="$(
      comm -12 <(printf '%s\n' "$base_all" | sed '/^$/d') <(printf '%s\n' "$run_any" | sed '/^$/d') \
        | while IFS= read -r t; do
            expected="$(for d in "${bases[@]}"; do awk -F '\t' -v t="$t" '$1 == t { print $2 }' "$d/$name.failure-messages"; done | sort -u)"
            for d in "${runs[@]}"; do
              got="$(awk -F '\t' -v t="$t" '$1 == t { print $2 }' "$d/$name.failure-messages")"
              if [ -n "$got" ] && ! printf '%s\n' "$expected" | grep -qxF -- "$got"; then
                printf '%s\t%s\t%s\n' "$t" "$d" "$got"
              fi
            done
          done
    )"

    verdict="pass"
    note=""
    base_min="$(for d in "${bases[@]}"; do cat "$d/$name.tests"; done | sort -n | head -1)"
    run_min="$(for d in "${runs[@]}"; do cat "$d/$name.tests"; done | sort -n | head -1)"
    if ! [[ "$base_min" =~ ^[0-9]+$ && "$run_min" =~ ^[0-9]+$ ]]; then
      verdict="fail"; note="$note unknown test count;"
    elif [ "$run_min" -lt "$base_min" ]; then
      verdict="fail"; note="$note a run ran fewer tests;"
    elif [ "$base_min" -eq 0 ]; then
      note="$note build-only, the baseline ran no tests;"
    fi
    base_silent_all="yes"
    for d in "${bases[@]}"; do
      if [ "$(cat "$d/$name.test-rc")" = "0" ] || [ -s "$d/$name.failures" ]; then base_silent_all="no"; fi
    done
    for d in "${runs[@]}"; do
      if [ "$(cat "$d/$name.test-rc")" != "0" ] && [ ! -s "$d/$name.failures" ] && [ "$base_silent_all" != "yes" ]; then
        verdict="fail"; note="$note $d exited $(cat "$d/$name.test-rc") naming no failing test;"
      fi
    done
    count() { printf '%s' "$1" | grep -c . || true; }
    if [ "$(count "$new")" -gt 0 ]; then
      verdict="fail"
      printf '%s\n' "$new" >"${runs[0]}/$name.new-failures"
    fi
    if [ "$(count "$changed")" -gt 0 ]; then
      verdict="fail"
      printf '%s\n' "$changed" >"${runs[0]}/$name.changed-errors"
    fi
    if [ "$(count "$flaky")" -gt 0 ]; then
      printf '%s\n' "$flaky" >"${runs[0]}/$name.flaky-in-baseline"
    fi
    if [ "$verdict" != "pass" ]; then failed=1; fi
    [ -n "$note" ] || note=" ok"
    echo "| $name |$note | $base_min/$run_min | $(count "$new") | $(count "$changed") | $(count "$flaky") | $(count "$gone") | $verdict |"
  done
  exit "$failed"
fi

consumers_file="${1:?consumers file required}"
mode="${2:?baseline, or a di-container sha}"
event_sha="${3:-}"

if [ "$mode" != "baseline" ] && [ -z "$event_sha" ]; then
  echo "commit mode needs both a di-container sha and an event sha" >&2
  exit 2
fi

label="$mode"
if [ "$mode" != "baseline" ]; then
  label="di-${mode:0:8}-ev-${event_sha:0:8}"
fi

root="${CONSUMER_CHECK_DIR:-${TMPDIR:-/tmp}/tsnomad-consumers}/$label"
mkdir -p "$root"
fixes="${CONSUMER_CHECK_FIXES:-}"

# A pnpm consumer needs pnpm on PATH. Without one installed, a shim runs it through npx.
if ! command -v pnpm >/dev/null 2>&1; then
  mkdir -p "$root/.bin"
  printf '#!/usr/bin/env bash\nexec npx -y pnpm@10 "$@"\n' >"$root/.bin/pnpm"
  chmod +x "$root/.bin/pnpm"
  export PATH="$root/.bin:$PATH"
fi

pin_overrides() {
  # $1 package.json, $2 manager, $3 extra overrides (package=spec,...)
  node - "$1" "$2" "$mode" "$event_sha" "${3:-}" <<'NODE'
const fs = require('fs');
const [file, manager, diSha, eventSha, extra] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (pkg.workspaces) {
  console.error(`${file} declares workspaces. Point the consumer list at the workspace root.`);
  process.exit(1);
}
const pins = {
  '@tsnomad/di-container': `github:tsnomad/di-container#${diSha}`,
  '@tsnomad/event': `github:tsnomad/event#${eventSha}`,
};
for (const pair of (extra || '').split(',').filter(Boolean)) {
  const at = pair.indexOf('=', 1);
  if (at < 0) {
    console.error(`extra override ${pair} is not package=spec`);
    process.exit(1);
  }
  pins[pair.slice(0, at)] = pair.slice(at + 1);
}
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(pins)) {
    if (pkg[section] && pkg[section][name]) pkg[section][name] = pins[name];
  }
}
if (manager === 'pnpm') {
  pkg.pnpm = pkg.pnpm || {};
  pkg.pnpm.overrides = { ...(pkg.pnpm.overrides || {}), ...pins };
} else {
  pkg.overrides = { ...(pkg.overrides || {}), ...pins };
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
NODE
}

check_pins() {
  # Run in the consumer folder after install. Prints one line per problem.
  node - "$mode" "$event_sha" <<'NODE'
const fs = require('fs');
const path = require('path');
const [diSha, eventSha] = process.argv.slice(2);
const pins = { '@tsnomad/di-container': diSha, '@tsnomad/event': eventSha };
const problems = [];

// Every installed copy, found by walking node_modules, including pnpm's store.
const copies = { '@tsnomad/di-container': [], '@tsnomad/event': [] };
const seen = new Set();
function walk(dir, depth) {
  if (depth > 12) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    let real;
    try { real = fs.realpathSync(full); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    if (entry.name === '@tsnomad') {
      for (const name of ['di-container', 'event']) {
        const pkg = path.join(full, name, 'package.json');
        if (fs.existsSync(pkg)) copies[`@tsnomad/${name}`].push(pkg);
      }
    }
    walk(full, depth + 1);
  }
}
walk('node_modules', 0);
for (const [name, list] of Object.entries(copies)) {
  if (list.length === 0) problems.push(`no installed copy of ${name}`);
  for (const pkg of list) {
    const version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
    if (version !== '0.2.0') problems.push(`${pkg} is version ${version}`);
  }
}

// Every lockfile entry for either package must resolve to its pinned commit.
const entries = { '@tsnomad/di-container': [], '@tsnomad/event': [] };
if (fs.existsSync('package-lock.json')) {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  for (const [key, value] of Object.entries(lock.packages || {})) {
    for (const name of Object.keys(entries)) {
      if (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) {
        entries[name].push(`${key} ${value.resolved || value.version || ''}`);
      }
    }
  }
} else if (fs.existsSync('pnpm-lock.yaml')) {
  // Only the packages section, not the overrides or importers echo.
  const lines = fs.readFileSync('pnpm-lock.yaml', 'utf8').split('\n');
  const start = lines.findIndex((line) => line === 'packages:');
  for (let i = start + 1; start >= 0 && i < lines.length && !/^\S/.test(lines[i]); i++) {
    const match = /^  '?(@tsnomad\/(?:di-container|event))@([^:']+)'?:\s*$/.exec(lines[i]);
    if (match) entries[match[1]].push(`${match[1]}@${match[2]}`);
  }
} else {
  problems.push('no lockfile after install');
}
for (const [name, list] of Object.entries(entries)) {
  if (list.length === 0) problems.push(`the lockfile has no entry for ${name}`);
  for (const entry of list) {
    if (!entry.includes(pins[name])) problems.push(`lockfile entry ${entry} is not at ${pins[name]}`);
  }
}
for (const problem of problems) console.log(problem);
process.exit(problems.length > 0 ? 1 : 0);
NODE
}

run_step() {
  # $1 log file, rest: command string, run in the current directory
  local log="$1"; shift
  bash -c "$*" >"$log" 2>&1
}

failed=0
echo "| consumer | commit | fixes | install | pins | build | test | failing tests |"
echo "|---|---|---|---|---|---|---|---|"

while IFS=$'\t' read -r name url subdir manager build test extra; do
  case "$name" in ''|'#'*) continue ;; esac
  clone="$root/$name"
  rm -rf "$clone"
  rm -f "$root/$name".*
  if ! git clone --quiet --depth 1 "$url" "$clone" >"$root/$name.clone.log" 2>&1; then
    echo "| $name | clone failed | - | - | - | - | - | - |"
    failed=1
    continue
  fi
  commit="$(git -C "$clone" rev-parse --short HEAD)"
  echo "$commit" >"$root/$name.commit"
  if [ "$mode" = "baseline" ]; then echo baseline; else echo check; fi >"$root/$name.mode"
  echo "-" >"$root/$name.pins"
  echo "no" >"$root/$name.built"
  echo "-" >"$root/$name.test-rc"
  echo "-" >"$root/$name.tests"
  : >"$root/$name.failures"
  : >"$root/$name.failure-messages"
  dir="$clone/$subdir"
  cd "$dir" || { echo "| $name | $commit | - | no $subdir | - | - | - | - |"; failed=1; continue; }

  fix="-"
  pins="-"
  if [ "$mode" != "baseline" ]; then
    if ! pin_overrides package.json "$manager" "${extra:-}" >"$root/$name.pin.log" 2>&1; then
      echo "| $name | $commit | - | - | pin failed | - | - | - |"
      failed=1
      cd "$root" || exit 2
      continue
    fi
    if [ -n "$fixes" ] && [ -f "$fixes/$name.patch" ]; then
      if git -C "$clone" apply "$fixes/$name.patch" >"$root/$name.fix.log" 2>&1; then
        fix="$name.patch"
      else
        echo "| $name | $commit | patch failed | - | - | - | - | - |"
        failed=1
        cd "$root" || exit 2
        continue
      fi
    fi
  fi

  if [ "$manager" = "pnpm" ]; then
    install_cmd="pnpm install --no-frozen-lockfile"
  else
    install_cmd="npm install --no-audit --no-fund"
  fi

  run_step "$root/$name.install.log" "$install_cmd"; install_rc=$?
  build_rc="-"; test_rc="-"; failing="-"
  if [ "$install_rc" -eq 0 ] && [ "$mode" != "baseline" ]; then
    if check_pins >"$root/$name.pins.log" 2>&1; then pins="ok"; else pins="failed"; fi
    echo "$pins" >"$root/$name.pins"
  fi
  if [ "$install_rc" -eq 0 ] && [ "$pins" != "failed" ]; then
    run_step "$root/$name.build.log" "$build"; build_rc=$?
    if [ "$build_rc" -eq 0 ]; then
      echo "yes" >"$root/$name.built"
      run_step "$root/$name.test.log" "$test"; test_rc=$?
      echo "$test_rc" >"$root/$name.test-rc"
      # Each FAIL line names a test, and the next non-empty line is the first line of its error.
      awk '
        /^[[:space:]]*FAIL[[:space:]]/ {
          if (want) print t "\t"
          t = $0
          sub(/^[[:space:]]*FAIL[[:space:]]+/, "", t); sub(/[[:space:]]+[0-9]+ms$/, "", t); sub(/[[:space:]]+$/, "", t)
          want = 1; next
        }
        want && NF { m = $0; sub(/[[:space:]]+$/, "", m); print t "\t" m; want = 0 }
        END { if (want) print t "\t" }
      ' "$root/$name.test.log" | sort -u >"$root/$name.failure-messages"
      cut -f1 "$root/$name.failure-messages" | sort -u >"$root/$name.failures"
      if grep -q 'No test files found' "$root/$name.test.log"; then
        echo 0 >"$root/$name.tests"
      else
        sed -nE 's/^[[:space:]]*Tests[[:space:]].*\(([0-9]+)\)[[:space:]]*$/\1/p' "$root/$name.test.log" | tail -1 \
          | grep . >"$root/$name.tests" || echo "?" >"$root/$name.tests"
      fi
      failing="$(grep -c . "$root/$name.failures" || true)"
    fi
  fi
  for rc in "$install_rc" "$build_rc" "$test_rc"; do
    if [ "$rc" != "0" ]; then failed=1; fi
  done
  if [ "$pins" = "failed" ]; then failed=1; fi
  echo "| $name | $commit | $fix | $install_rc | $pins | $build_rc | $test_rc | $failing |"
  cd "$root" || exit 2
done <"$consumers_file"

echo
echo "Logs: $root"
exit "$failed"
