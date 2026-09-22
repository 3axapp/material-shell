#!/usr/bin/env bash
#
# Runs every tests/shell/*.test.js inside its own nested gnome-shell and exits
# non-zero if any of them fails. See tests/README.md.
#
# Each test gets a throwaway HOME holding a copy of dist/, whose extension.js is
# replaced by a two-line wrapper that re-exports the real bundle and imports the
# test next to it. The shell runs as a devkit, so a Mutter Development Kit
# window shows up for a few seconds per test.
#
#   KEEP=1 tests/shell/run.sh   keep every HOME and log, not only failed ones

set -euo pipefail

uuid=material-shell@papyelgringo
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"

if [ ! -f dist/extension.js ]; then
    echo "dist/ is not built, run make compile first" >&2
    exit 2
fi

# Prints each JS ERROR block of the log whose stack runs through the extension.
extension_errors() {
    awk -v path="extensions/$uuid/" '
        /JS ERROR/ { block = $0; open = 1; next }
        open && /^$/ { if (index(block, path)) print block "\n"; open = 0; next }
        open { block = block "\n" $0 }
        END { if (open && index(block, path)) print block }
    ' "$1"
}

run_test() {
    local test=$1 name home log extension errors results failed=0
    name=$(basename "$test" .test.js)
    home=$(mktemp -d "${TMPDIR:-/tmp}/ms-shell-test.XXXXXX")
    log=$home/log
    extension=$home/.local/share/gnome-shell/extensions/$uuid

    mkdir -p "$(dirname "$extension")"
    cp -r dist "$extension"
    mv "$extension/extension.js" "$extension/extension.real.js"
    mkdir "$extension/shell-test"
    cp tests/shell/lib.js "$test" "$extension/shell-test/"
    cat > "$extension/extension.js" <<WRAPPER
export { default } from './extension.real.js';
import './shell-test/$(basename "$test")';
WRAPPER

    echo "$name"
    env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_CACHE_HOME \
        HOME="$home" MS_UUID="$uuid" \
        timeout 60 dbus-run-session -- sh -c '
            dconf write /org/gnome/shell/enabled-extensions "[\"$MS_UUID\"]"
            dconf write /org/gnome/shell/disable-user-extensions false
            exec gnome-shell --devkit --wayland-display "ms-test-$$"
        ' > "$log" 2>&1 || true

    results=$(sed -n 's/^MSTEST-Message: [0-9:.]*: //p' "$log")
    [ -n "$results" ] && printf '%s\n' "$results" | grep -v '^DONE' | sed 's/^/  /'
    grep -q '^FAIL' <<< "$results" && failed=1
    if ! grep -q '^DONE' <<< "$results"; then
        echo "  FAIL the test never finished: the shell hung or crashed"
        failed=1
    fi
    errors=$(extension_errors "$log")
    if [ -n "$errors" ]; then
        echo "  FAIL JS ERROR from the extension:"
        printf '%s\n' "$errors" | sed 's/^/    /'
        failed=1
    fi

    if [ "$failed" = 1 ] || [ "${KEEP:-}" = 1 ]; then
        echo "  log: $log"
    else
        rm -rf "$home"
    fi
    return "$failed"
}

status=0
for test in tests/shell/*.test.js; do
    run_test "$test" || status=1
done
exit "$status"
