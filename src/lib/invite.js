const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * A link other devices can open to reach this game, optionally straight into a room.
 * On localhost the page URL is useless to other devices, so ask the server for its LAN address.
 */
export async function getShareUrl(code) {
    const fallback = new URL(location.origin + location.pathname);
    if (code) fallback.searchParams.set('room', code);

    if (!LOCAL_HOSTS.includes(location.hostname)) return fallback.toString();
    try {
        const response = await fetch('/api/network-url');
        if (!response.ok) throw new Error(String(response.status));
        const { url } = await response.json();
        const networkUrl = new URL(url);
        if (location.port && location.port !== networkUrl.port) networkUrl.port = location.port;
        if (code) networkUrl.searchParams.set('room', code);
        return networkUrl.toString();
    } catch {
        return fallback.toString();
    }
}

/** Whether `url` points somewhere other devices can't reach. */
export function isLocalOnly(url) {
    return LOCAL_HOSTS.includes(new URL(url).hostname.replace(/^\[|\]$/g, ''));
}
