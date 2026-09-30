// Storage can throw (private mode, blocked cookies), so every access is guarded.

function wrap(getStore) {
    return {
        get(key, fallback = null) {
            try {
                const raw = getStore().getItem(key);
                return raw == null ? fallback : JSON.parse(raw);
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                getStore().setItem(key, JSON.stringify(value));
            } catch {
                /* ignore */
            }
        },
        remove(key) {
            try {
                getStore().removeItem(key);
            } catch {
                /* ignore */
            }
        }
    };
}

/** Survives reloads and restarts: display name, sound, preferences. */
export const prefs = wrap(() => window.localStorage);

/** Per tab: the seat this tab occupies, so refreshing rejoins the same game. */
export const session = wrap(() => window.sessionStorage);
