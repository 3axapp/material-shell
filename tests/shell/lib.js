/*
 * Helpers for tests that run inside a nested gnome-shell, loaded next to the
 * extension by run.sh. Results are logged under their own domain, which run.sh
 * picks out of the shell's output:
 *
 *   MSTEST-Message: …: PASS <name>
 *   MSTEST-Message: …: FAIL <name>: <details>
 *   MSTEST-Message: …: DONE failed=<n>
 */

import GLib from 'gi://GLib';

function report(message) {
    GLib.log_structured('MSTEST', GLib.LogLevelFlags.LEVEL_MESSAGE, {
        MESSAGE: message,
    });
}

export function wait(ms) {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Resolves to true as soon as `predicate` holds, or to false once `timeoutMs`
 * has passed. The shell settles over several frames, so a single look at its
 * state tells little; an exception from the predicate counts as "not yet".
 */
export async function until(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (predicate()) return true;
        } catch (_error) {
            // Not ready yet.
        }
        await wait(50);
    }
    return false;
}

let failures = 0;

export function check(name, ok, details = '') {
    if (ok) {
        report(`PASS ${name}`);
    } else {
        failures++;
        report(`FAIL ${name}${details ? `: ${details}` : ''}`);
    }
    return ok;
}

/** Runs the test body, then shuts the shell down so run.sh gets its result. */
export function run(body) {
    body()
        .catch((error) => check('test body', false, `${error}\n${error.stack}`))
        .finally(() => {
            report(`DONE failed=${failures}`);
            global.context.terminate();
        });
}
