#!/usr/bin/env bash
# Builds and tests TS Nomad consumers against exact di-container and event
# commits, and compares the results with a baseline run.
#
# Usage:
#   scripts/consumer-check.sh <consumers.tsv> baseline
#   scripts/consumer-check.sh <consumers.tsv> <di-container-sha> <event-sha>
#   scripts/consumer-check.sh compare <baseline-dir> <run-dir> [<rerun-dir>]
#
# consumers.tsv has one consumer per line, tab separated, '#' for comments:
#   name  clone-url  subdir  manager(npm|pnpm)  build-command  test-command
# The test command must be the consumer's real test command, not a no-op.
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
# install, the script checks that every installed copy of both packages
# is 0.2.0 and that the lockfile records both commits. A consumer whose
# pins do not hold fails, so a green row always means the new code ran.
#
# Tests run only when the build passed. The failing test names, read from
# vitest's FAIL lines, go to <consumer>.failures next to the logs.
#
# Compare mode reads two run folders. A consumer passes when its run
# installed, pinned and built, its commit matches the baseline's, and no
# test fails in the run that did not fail in the baseline. A test that
# fails in the baseline and passes in the run is reported, not counted
# against the consumer. With a third folder, a rerun of the same mode, a
# new failure counts only when it fails in both runs, which separates a
# regression from a timeout under load.
#
# The script never commits or pushes in a clone. It exits 1 when any row
# failed, 0 when all passed.

set -u -o pipefail

if [ "${1:-}" = "compare" ]; then
  base="${2:?baseline run folder required}"
  run="${3:?run folder required}"
  rerun="${4:-}"
  failed=0
  echo "| consumer | same commit | built | new failures | no longer failing | verdict |"
  echo "|---|---|---|---|---|---|"
  for commit_file in "$base"/*.commit; do
    name="$(basename "$commit_file" .commit)"
    verdict="pass"
    same="yes"
    if [ ! -f "$run/$name.commit" ]; then
      echo "| $name | missing from run | - | - | - | fail |"
      failed=1
      continue
    fi
    if [ "$(cat "$commit_file")" != "$(cat "$run/$name.commit")" ]; then
      same="no"
      verdict="fail"
    fi
    built="$(cat "$run/$name.built" 2>/dev/null || echo no)"
    if [ "$built" != "yes" ]; then verdict="fail"; fi
    new="$(comm -13 <(sort -u "$base/$name.failures" 2>/dev/null) <(sort -u "$run/$name.failures" 2>/dev/null))"
    if [ -n "$rerun" ] && [ -n "$new" ]; then
      new="$(comm -12 <(printf '%s\n' "$new") <(sort -u "$rerun/$name.failures" 2>/dev/null))"
    fi
    gone="$(comm -23 <(sort -u "$base/$name.failures" 2>/dev/null) <(sort -u "$run/$name.failures" 2>/dev/null))"
    new_count="$(printf '%s' "$new" | grep -c . || true)"
    gone_count="$(printf '%s' "$gone" | grep -c . || true)"
    if [ "$new_count" -gt 0 ]; then
      verdict="fail"
      printf '%s\n' "$new" >"$run/$name.new-failures"
    fi
    if [ "$verdict" != "pass" ]; then failed=1; fi
    echo "| $name | $same | $built | $new_count | $gone_count | $verdict |"
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
  # $1 package.json, $2 manager
  node - "$1" "$2" "$mode" "$event_sha" <<'NODE'
const fs = require('fs');
const [file, manager, diSha, eventSha] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (pkg.workspaces) {
  console.error(`${file} declares workspaces. Point the consumer list at the workspace root.`);
  process.exit(1);
}
const pins = {
  '@tsnomad/di-container': `github:tsnomad/di-container#${diSha}`,
  '@tsnomad/event': `github:tsnomad/event#${eventSha}`,
};
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
  local problems=0 copy version lock
  while IFS= read -r copy; do
    version="$(node -p "JSON.parse(require('fs').readFileSync('$copy', 'utf8')).version" 2>/dev/null || echo unreadable)"
    if [ "$version" != "0.2.0" ]; then
      echo "$copy is version $version"
      problems=1
    fi
  done < <(find node_modules \( -path '*/@tsnomad/di-container/package.json' -o -path '*/@tsnomad/event/package.json' \) 2>/dev/null)
  lock=""
  for candidate in package-lock.json pnpm-lock.yaml; do
    if [ -f "$candidate" ]; then lock="$candidate"; fi
  done
  if [ -z "$lock" ]; then
    echo "no lockfile after install"
    problems=1
  else
    for sha in "$mode" "$event_sha"; do
      if ! grep -q "$sha" "$lock"; then
        echo "$lock does not record $sha"
        problems=1
      fi
    done
  fi
  return "$problems"
}

run_step() {
  # $1 log file, rest: command string, run in the current directory
  local log="$1"; shift
  bash -c "$*" >"$log" 2>&1
}

failed=0
echo "| consumer | commit | fixes | install | pins | build | test | failing tests |"
echo "|---|---|---|---|---|---|---|---|"

while IFS=$'\t' read -r name url subdir manager build test; do
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
  echo "no" >"$root/$name.built"
  : >"$root/$name.failures"
  dir="$clone/$subdir"
  cd "$dir" || { echo "| $name | $commit | - | no $subdir | - | - | - | - |"; failed=1; continue; }

  fix="-"
  pins="-"
  if [ "$mode" != "baseline" ]; then
    if ! pin_overrides package.json "$manager" >"$root/$name.pin.log" 2>&1; then
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
  fi
  if [ "$install_rc" -eq 0 ] && [ "$pins" != "failed" ]; then
    run_step "$root/$name.build.log" "$build"; build_rc=$?
    if [ "$build_rc" -eq 0 ]; then
      echo "yes" >"$root/$name.built"
      run_step "$root/$name.test.log" "$test"; test_rc=$?
      grep -E '^[[:space:]]*FAIL[[:space:]]' "$root/$name.test.log" \
        | sed -E 's/^[[:space:]]*FAIL[[:space:]]+//; s/[[:space:]]+[0-9]+ms$//; s/[[:space:]]+$//' \
        | sort -u >"$root/$name.failures"
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
