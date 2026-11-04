// Thin client for the Last.fm API 2.0 (read-only methods only).
// Docs: https://www.last.fm/api
export const BASE_URL = "https://ws.audioscrobbler.com/2.0/";
export class LastfmError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LastfmError";
    }
}
export class LastfmClient {
    apiKey;
    fetchImpl;
    minIntervalMs;
    baseUrl;
    lastCall = 0;
    constructor(opts) {
        if (!opts.apiKey)
            throw new Error("LASTFM_API_KEY is required");
        this.apiKey = opts.apiKey;
        this.fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
        this.minIntervalMs = opts.minIntervalMs ?? 250;
        this.baseUrl = opts.baseUrl ?? BASE_URL;
    }
    /** Call a Last.fm method. Undefined and empty params are dropped. */
    async call(method, params = {}) {
        const qs = new URLSearchParams({ method, api_key: this.apiKey, format: "json" });
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== "")
                qs.set(k, String(v));
        }
        const wait = this.lastCall + this.minIntervalMs - Date.now();
        if (wait > 0)
            await new Promise((r) => setTimeout(r, wait));
        this.lastCall = Date.now();
        const res = await this.fetchImpl(`${this.baseUrl}?${qs}`, { method: "GET", headers: { Accept: "application/json" } });
        if (res.status === 403 || res.status === 429)
            throw new LastfmError(res.status, "Last.fm rate limit or access refused, retry later.");
        // Unknown users and artists come back as HTTP 404 with no JSON error body.
        if (res.status === 404)
            throw new LastfmError(404, "Not found on Last.fm: check the username or artist name.");
        if (!res.ok)
            throw new LastfmError(res.status, `Last.fm returned HTTP ${res.status}.`);
        const body = (await res.json());
        // Last.fm reports most failures as HTTP 200 with an error code in the body.
        if (typeof body.error === "number") {
            if (body.error === 10 || body.error === 26)
                throw new LastfmError(body.error, "Last.fm rejected the API key (check LASTFM_API_KEY).");
            if (body.error === 29)
                throw new LastfmError(29, "Last.fm rate limit reached, retry later.");
            throw new LastfmError(body.error, `Last.fm error ${body.error}: ${body.message ?? "unknown error"}`);
        }
        return body;
    }
}
