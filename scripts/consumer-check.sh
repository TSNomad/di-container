#!/usr/bin/env bash
# Builds and tests TS Nomad consumers against exact di-container and event commits.
#
# Usage:
#   scripts/consumer-check.sh <consumers.tsv> baseline
#   scripts/consumer-check.sh <consumers.tsv> <di-container-sha> <event-sha>
#
# consumers.tsv has one consumer per line, tab separated, '#' for comments:
#   name  clone-url  subdir  manager(npm|pnpm)  build-command  test-command
#
# Each consumer gets a fresh shallow clone under $CONSUMER_CHECK_DIR
# (default: $TMPDIR/tsnomad-consumers). In the commit mode, the script
# points every @tsnomad/di-container and @tsnomad/event in the tree at
# the given commits, direct or transitive, through the package manager's
# overrides, then installs, builds and tests. Baseline mode changes
# nothing. The script never commits or pushes in a clone.
#
# It prints a markdown table of exit codes and keeps each step's log next
# to the clone. It exits 1 when any step failed, 0 when all passed.

set -u -o pipefail

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

run_step() {
  # $1 log file, rest: command string, run in the current directory
  local log="$1"; shift
  bash -c "$*" >"$log" 2>&1
}

failed=0
echo "| consumer | commit | install | build | test |"
echo "|---|---|---|---|---|"

while IFS=$'\t' read -r name url subdir manager build test; do
  case "$name" in ''|'#'*) continue ;; esac
  clone="$root/$name"
  rm -rf "$clone"
  if ! git clone --quiet --depth 1 "$url" "$clone" >"$root/$name.clone.log" 2>&1; then
    echo "| $name | clone failed | - | - | - |"
    failed=1
    continue
  fi
  commit="$(git -C "$clone" rev-parse --short HEAD)"
  dir="$clone/$subdir"
  cd "$dir" || { echo "| $name | $commit | no $subdir | - | - |"; failed=1; continue; }

  if [ "$mode" != "baseline" ]; then
    pin_overrides package.json "$manager"
  fi

  if [ "$manager" = "pnpm" ]; then
    install_cmd="pnpm install --no-frozen-lockfile"
  else
    install_cmd="npm install --no-audit --no-fund"
  fi

  run_step "$root/$name.install.log" "$install_cmd"; install_rc=$?
  build_rc="-"; test_rc="-"
  if [ "$install_rc" -eq 0 ]; then
    run_step "$root/$name.build.log" "$build"; build_rc=$?
    run_step "$root/$name.test.log" "$test"; test_rc=$?
  fi
  for rc in "$install_rc" "$build_rc" "$test_rc"; do
    if [ "$rc" != "0" ]; then failed=1; fi
  done
  echo "| $name | $commit | $install_rc | $build_rc | $test_rc |"
  cd "$root" || exit 2
done <"$consumers_file"

echo
echo "Logs: $root"
exit "$failed"
