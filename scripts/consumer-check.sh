#!/usr/bin/env bash
# Builds and tests TS Nomad consumers against exact di-container and event
# commits, and compares check runs with baseline runs.
#
# Usage:
#   scripts/consumer-check.sh <consumers.tsv> baseline
#   scripts/consumer-check.sh <consumers.tsv> <di-container-sha> <event-sha>
#   scripts/consumer-check.sh compare <consumers.tsv> <baseline-dir>,<baseline-dir>[,...] <run-dir>,<run-dir>[,...]
#
# consumers.tsv has one consumer per line, tab separated, '#' for comments:
#   name  clone-url  subdir  manager(npm|pnpm)  build-command  test-command  [extra-overrides]
# Every field but the last is required, and a malformed row fails. The test
# command must be the consumer's real test command, not a no-op. A consumer
# whose tests never load either package also runs its built binary once in
# that command, so its wiring runs on the new code. extra-overrides is
# optional: comma separated package=spec pairs that commit mode also pins,
# such as a dependency that itself needs the 0.2.0 fixes and is built from
# a throwaway clone with a file: spec.
#
# Each run gets a new folder under $CONSUMER_CHECK_DIR (default:
# $TMPDIR/tsnomad-consumers), named after the mode and the time, and each
# consumer a fresh shallow clone in it. Baseline mode changes nothing in the
# clone.
#
# Commit mode points every @tsnomad/di-container and @tsnomad/event in the
# tree at the given commits, direct or transitive, through the package
# manager's overrides. If $CONSUMER_CHECK_FIXES names a folder holding
# <consumer>.patch, that patch is applied to the clone before install. A
# fix patch carries only the documented 0.2.0 migration fixes. After
# install, the script checks that each package has at least one installed
# copy, that every copy is 0.2.0 and holds the same src files as its pinned
# commit, wherever it sits, and that every lockfile entry for either
# package resolves to its pinned commit. A consumer whose pins do not hold
# fails, so a green row always means the new code ran.
#
# Tests run only when the build passed. Next to the logs, each consumer
# gets <consumer>.mode, .pinned, .commit, .pins, .built, .test-rc, .tests
# (the number of tests vitest ran), .failures (failing test names, from
# vitest's FAIL lines), .failure-messages (each failing test with the first
# line of its error, shared by every test vitest groups under that error),
# .unhandled-count (vitest's Errors count) and .unhandled (the first line of
# each unhandled error).
#
# Compare mode takes the consumer list, two or more baseline folders and
# two or more run folders, comma separated, all different. Every folder
# must hold every listed consumer, at the same commit, built, with a test
# exit code. Baseline folders must come from baseline mode, and run
# folders from commit mode, with pins ok and all pinned to the same
# commits. A test counts as failing in the baseline when it failed in any
# baseline folder, and one that failed in some baseline folders but not
# all is listed as flaky. A consumer passes when:
#   - no baseline failure is a timeout, because a timeout hides its reason,
#   - no test fails in any run folder that did not fail in the baseline,
#   - every test that fails in every baseline folder and in a run fails
#     there with the same first error line, and that line is known,
#   - no run exits non-zero without naming a failing test, unless every
#     baseline did the same,
#   - no run ran fewer tests than the smallest baseline,
#   - no run has more unhandled errors than the largest baseline, or an
#     unhandled error line that no baseline had.
# A consumer whose baseline ran no tests is marked build-only. A baseline
# failure that passes in every run is reported and does not count against
# the consumer.
#
# The script never commits or pushes in a clone. It exits 1 when any row
# failed, 0 when all passed.

set -u -o pipefail

# Reads one consumer row into globals and checks it. Returns 1 for a malformed row.
parse_row() {
  local line="$1"
  name="$(printf '%s' "$line" | cut -f1)"
  url="$(printf '%s' "$line" | cut -f2)"
  subdir="$(printf '%s' "$line" | cut -f3)"
  manager="$(printf '%s' "$line" | cut -f4)"
  build="$(printf '%s' "$line" | cut -f5)"
  test="$(printf '%s' "$line" | cut -f6)"
  extra="$(printf '%s' "$line" | cut -f7)"
  [ -n "$name" ] && [ -n "$url" ] && [ -n "$subdir" ] && [ -n "$build" ] && [ -n "$test" ] || return 1
  [ "$manager" = "npm" ] || [ "$manager" = "pnpm" ] || return 1
}

# Prints the consumer rows of a list, skipping comments and blank lines,
# including a last line with no trailing newline.
list_rows() {
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    printf '%s\n' "$line"
  done <"$1"
}

if [ "${1:-}" = "compare" ]; then
  list="${2:?consumer list required}"
  IFS=',' read -r -a bases <<<"${3:?baseline run folders required}"
  IFS=',' read -r -a runs <<<"${4:?run folders required}"
  if [ "${#bases[@]}" -lt 2 ] || [ "${#runs[@]}" -lt 2 ]; then
    echo "compare needs at least two baseline folders and two run folders" >&2
    exit 2
  fi
  real_dirs="$(for d in "${bases[@]}" "${runs[@]}"; do realpath -m "$d"; done)"
  if [ "$(printf '%s\n' "$real_dirs" | sort | uniq -d | grep -c .)" -gt 0 ]; then
    echo "compare got the same folder twice: $(printf '%s\n' "$real_dirs" | sort | uniq -d | tr '\n' ' ')" >&2
    exit 2
  fi
  pinned_first="$(cat "${runs[0]}/run.pinned" 2>/dev/null || echo missing)"
  failed=0
  count() { printf '%s' "$1" | grep -c . || true; }
  echo "| consumer | checks | tests base/run | new failures | changed errors | unhandled base/run | flaky in baseline | no longer failing | verdict |"
  echo "|---|---|---|---|---|---|---|---|---|"
  while IFS= read -r line; do
    if ! parse_row "$line"; then
      echo "| ${name:-?} | malformed row in the consumer list | - | - | - | - | - | - | fail |"
      failed=1
      continue
    fi
    commit="$(cat "${bases[0]}/$name.commit" 2>/dev/null || echo missing)"
    problems=""
    for dir in "${bases[@]}" "${runs[@]}"; do
      for part in commit built test-rc tests failures failure-messages unhandled-count unhandled mode; do
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
      [ "$(cat "$dir/run.pinned" 2>/dev/null)" = "$pinned_first" ] || problems="$problems $dir pinned other commits;"
    done
    if [ -n "$problems" ]; then
      echo "| $name |$problems | - | - | - | - | - | - | fail |"
      failed=1
      continue
    fi

    base_any="$(for d in "${bases[@]}"; do cat "$d/$name.failures"; done | sed '/^$/d' | sort -u)"
    base_all="$(for d in "${bases[@]}"; do sort -u "$d/$name.failures"; done | sed '/^$/d' | sort | uniq -c \
      | awk -v n="${#bases[@]}" '$1 == n { $1 = ""; sub(/^ /, ""); print }')"
    flaky="$(comm -23 <(printf '%s\n' "$base_any" | sed '/^$/d') <(printf '%s\n' "$base_all" | sed '/^$/d'))"
    run_any="$(for d in "${runs[@]}"; do cat "$d/$name.failures"; done | sed '/^$/d' | sort -u)"
    new="$(comm -13 <(printf '%s\n' "$base_any" | sed '/^$/d') <(printf '%s\n' "$run_any" | sed '/^$/d'))"
    gone="$(comm -23 <(printf '%s\n' "$base_any" | sed '/^$/d') <(printf '%s\n' "$run_any" | sed '/^$/d'))"
    timeouts="$(for d in "${bases[@]}"; do cut -f2 "$d/$name.failure-messages"; done | grep -ci 'timed out' || true)"
    # Tests failing in every baseline and in a run: compare first error lines.
    changed="$(
      comm -12 <(printf '%s\n' "$base_all" | sed '/^$/d') <(printf '%s\n' "$run_any" | sed '/^$/d') \
        | while IFS= read -r t; do
            expected="$(for d in "${bases[@]}"; do awk -F '\t' -v t="$t" '$1 == t { print $2 }' "$d/$name.failure-messages"; done | sort -u)"
            for d in "${runs[@]}"; do
              grep -qxF -- "$t" "$d/$name.failures" || continue
              got="$(awk -F '\t' -v t="$t" '$1 == t { print $2 }' "$d/$name.failure-messages" | head -1)"
              if [ -z "$got" ] || printf '%s\n' "$expected" | grep -qx '' || ! printf '%s\n' "$expected" | grep -qxF -- "$got"; then
                printf '%s\t%s\t%s\n' "$t" "$d" "${got:-unknown}"
              fi
            done
          done
    )"
    unhandled_base_max="$(for d in "${bases[@]}"; do cat "$d/$name.unhandled-count"; done | sort -n | tail -1)"
    unhandled_run_max="$(for d in "${runs[@]}"; do cat "$d/$name.unhandled-count"; done | sort -n | tail -1)"
    unhandled_new="$(comm -13 <(for d in "${bases[@]}"; do cat "$d/$name.unhandled"; done | sed '/^$/d' | sort -u) \
      <(for d in "${runs[@]}"; do cat "$d/$name.unhandled"; done | sed '/^$/d' | sort -u))"

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
    if [ "$timeouts" -gt 0 ]; then
      verdict="fail"; note="$note the baselines hold $timeouts timeouts, rerun them quieter;"
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
    if ! [[ "$unhandled_base_max" =~ ^[0-9]+$ && "$unhandled_run_max" =~ ^[0-9]+$ ]]; then
      verdict="fail"; note="$note unknown unhandled error count;"
    elif [ "$unhandled_run_max" -gt "$unhandled_base_max" ] || [ "$(count "$unhandled_new")" -gt 0 ]; then
      verdict="fail"; note="$note new unhandled errors;"
      printf '%s\n' "$unhandled_new" >"${runs[0]}/$name.new-unhandled"
    fi
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
    echo "| $name |$note | $base_min/$run_min | $(count "$new") | $(count "$changed") | ${unhandled_base_max}/${unhandled_run_max} | $(count "$flaky") | $(count "$gone") | $verdict |"
  done < <(list_rows "$list")
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

root="${CONSUMER_CHECK_DIR:-${TMPDIR:-/tmp}/tsnomad-consumers}/$label-$(date +%Y%m%dT%H%M%S)"
if [ -e "$root" ]; then
  echo "$root already exists" >&2
  exit 2
fi
mkdir -p "$root"
fixes="${CONSUMER_CHECK_FIXES:-}"
if [ "$mode" = "baseline" ]; then echo "baseline" >"$root/run.pinned"; else echo "$mode $event_sha" >"$root/run.pinned"; fi

# A pnpm consumer needs pnpm on PATH. Without one installed, a shim runs it through npx.
if ! command -v pnpm >/dev/null 2>&1; then
  mkdir -p "$root/.bin"
  printf '#!/usr/bin/env bash\nexec npx -y pnpm@10 "$@"\n' >"$root/.bin/pnpm"
  chmod +x "$root/.bin/pnpm"
  export PATH="$root/.bin:$PATH"
fi

# The pinned commits' src folders, which every installed copy must match.
refs="$root/.refs"
if [ "$mode" != "baseline" ]; then
  for pair in "di-container $mode" "event $event_sha"; do
    set -- $pair
    if ! { git clone --quiet "https://github.com/tsnomad/$1.git" "$refs/$1" && git -C "$refs/$1" checkout --quiet "$2"; } >"$root/ref-$1.log" 2>&1; then
      echo "could not check out tsnomad/$1 at $2, see $root/ref-$1.log" >&2
      exit 2
    fi
  done
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
  node - "$mode" "$event_sha" "$refs" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [diSha, eventSha, refs] = process.argv.slice(2);
const pins = { '@tsnomad/di-container': diSha, '@tsnomad/event': eventSha };
const problems = [];

function srcHash(dir) {
  const hash = crypto.createHash('sha256');
  const files = [];
  (function list(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) list(full);
      else files.push(full);
    }
  })(dir);
  for (const file of files.map((f) => path.relative(dir, f)).sort()) {
    hash.update(file + '\0');
    hash.update(fs.readFileSync(path.join(dir, file)));
  }
  return hash.digest('hex');
}
const expected = {
  '@tsnomad/di-container': srcHash(path.join(refs, 'di-container', 'src')),
  '@tsnomad/event': srcHash(path.join(refs, 'event', 'src')),
};

// Every installed copy, found by walking node_modules through every link,
// so copies inside a file: dependency's own tree count too.
const copies = { '@tsnomad/di-container': [], '@tsnomad/event': [] };
const seen = new Set();
function walk(dir, depth) {
  if (depth > 14) return;
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
        const pkg = path.join(full, name);
        if (fs.existsSync(path.join(pkg, 'package.json'))) copies[`@tsnomad/${name}`].push(pkg);
      }
    }
    walk(full, depth + 1);
  }
}
walk('node_modules', 0);
for (const [name, list] of Object.entries(copies)) {
  if (list.length === 0) problems.push(`no installed copy of ${name}`);
  for (const pkg of list) {
    const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
    if (version !== '0.2.0') problems.push(`${pkg} is version ${version}`);
    let hash = 'no src';
    try { hash = srcHash(path.join(pkg, 'src')); } catch {}
    if (hash !== expected[name]) problems.push(`${pkg} does not hold the src of ${name} at ${pins[name]}`);
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
  // Only the packages section, not the overrides or importers echo. A key
  // is the package name, an @ and its spec, which may hold colons.
  const lines = fs.readFileSync('pnpm-lock.yaml', 'utf8').split('\n');
  const start = lines.findIndex((line) => line === 'packages:');
  for (let i = start + 1; start >= 0 && i < lines.length && !/^\S/.test(lines[i]); i++) {
    const match = /^  '?(@tsnomad\/(?:di-container|event))@(.+?)'?:\s*$/.exec(lines[i]);
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

# Reads a vitest log into the result files for one consumer.
read_results() {
  local log="$1" out="$2"
  # FAIL lines name tests. vitest prints a group of FAIL lines above the
  # one error they share, so every test in the group gets that error's
  # first line. A test with no error line gets an empty one.
  awk '
    /^[[:space:]]*FAIL[[:space:]]/ {
      t = $0
      sub(/^[[:space:]]*FAIL[[:space:]]+/, "", t); sub(/[[:space:]]+[0-9]+ms$/, "", t); sub(/[[:space:]]+$/, "", t)
      pending[++n] = t; next
    }
    n && NF {
      m = $0; sub(/[[:space:]]+$/, "", m)
      for (i = 1; i <= n; i++) print pending[i] "\t" m
      n = 0
    }
    END { for (i = 1; i <= n; i++) print pending[i] "\t" }
  ' "$log" | sort -u >"$out.failure-messages"
  cut -f1 "$out.failure-messages" | sort -u >"$out.failures"
  if grep -q 'No test files found' "$log"; then
    echo 0 >"$out.tests"
  else
    sed -nE 's/^[[:space:]]*Tests[[:space:]].*\(([0-9]+)\)[[:space:]]*$/\1/p' "$log" | tail -1 \
      | grep . >"$out.tests" || echo "?" >"$out.tests"
  fi
  sed -nE 's/^[[:space:]]*Errors[[:space:]]+([0-9]+)[[:space:]]+errors?[[:space:]]*$/\1/p' "$log" | tail -1 \
    | grep . >"$out.unhandled-count" || echo 0 >"$out.unhandled-count"
  # The first line after each "Unhandled Error" or "Unhandled Rejection" banner.
  awk '/Unhandled (Error|Rejection)[^s]/ { want = 1; next } want && NF { print; want = 0 }' "$log" \
    | sed -E 's/[[:space:]]+$//' | sort -u >"$out.unhandled"
}

failed=0
echo "| consumer | commit | fixes | install | pins | build | test | failing tests | unhandled |"
echo "|---|---|---|---|---|---|---|---|---|"

while IFS= read -r line; do
  if ! parse_row "$line"; then
    echo "| ${name:-?} | malformed row in the consumer list | - | - | - | - | - | - | - |"
    failed=1
    continue
  fi
  clone="$root/$name"
  if ! git clone --quiet --depth 1 "$url" "$clone" >"$root/$name.clone.log" 2>&1; then
    echo "| $name | clone failed | - | - | - | - | - | - | - |"
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
  echo "-" >"$root/$name.unhandled-count"
  : >"$root/$name.failures"
  : >"$root/$name.failure-messages"
  : >"$root/$name.unhandled"
  dir="$clone/$subdir"
  cd "$dir" || { echo "| $name | $commit | - | no $subdir | - | - | - | - | - |"; failed=1; continue; }

  fix="-"
  pins="-"
  if [ "$mode" != "baseline" ]; then
    if ! pin_overrides package.json "$manager" "${extra:-}" >"$root/$name.pin.log" 2>&1; then
      echo "| $name | $commit | - | - | pin failed | - | - | - | - |"
      failed=1
      cd "$root" || exit 2
      continue
    fi
    if [ -n "$fixes" ] && [ -f "$fixes/$name.patch" ]; then
      if git -C "$clone" apply "$fixes/$name.patch" >"$root/$name.fix.log" 2>&1; then
        fix="$name.patch"
      else
        echo "| $name | $commit | patch failed | - | - | - | - | - | - |"
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
  build_rc="-"; test_rc="-"; failing="-"; unhandled="-"
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
      read_results "$root/$name.test.log" "$root/$name"
      failing="$(grep -c . "$root/$name.failures" || true)"
      unhandled="$(cat "$root/$name.unhandled-count")"
    fi
  fi
  for rc in "$install_rc" "$build_rc" "$test_rc"; do
    if [ "$rc" != "0" ]; then failed=1; fi
  done
  if [ "$pins" = "failed" ]; then failed=1; fi
  echo "| $name | $commit | $fix | $install_rc | $pins | $build_rc | $test_rc | $failing | $unhandled |"
  cd "$root" || exit 2
done < <(list_rows "$consumers_file")

echo
echo "Logs: $root"
exit "$failed"
