#!/usr/bin/env node
// Last.fm MCP server, READ-ONLY. No tool writes to Last.fm (no scrobble, no love).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LastfmClient, LastfmError } from "./client.js";
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const period = z.enum(["overall", "7day", "1month", "3month", "6month", "12month"]).optional();
const limit = z.number().int().min(1).max(200).optional();
export function buildServer(client, defaultUser) {
    const server = new McpServer({ name: "lastfm-readonly", version: "0.1.0" });
    const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
    const fail = (err) => ({
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    });
    const run = async (fn) => {
        try {
            return ok(await fn());
        }
        catch (err) {
            return fail(err);
        }
    };
    const who = (user) => {
        const u = user ?? defaultUser;
        if (!u)
            throw new Error("Give a Last.fm username, or set LASTFM_USERNAME to use your own account by default.");
        return u;
    };
    server.registerTool("lastfm_get_user", {
        title: "Get user",
        description: "Profile and totals (scrobbles, artists, albums, tracks) of a Last.fm user. Defaults to your own account.",
        inputSchema: { user: z.string().min(1).optional() },
    }, ({ user }) => run(async () => {
        const r = await client.call("user.getInfo", { user: who(user) });
        const u = r.user;
        return {
            name: u.name,
            realname: u.realname,
            url: u.url,
            registered: u.registered?.unixtime,
            scrobbles: u.playcount,
            artists: u.artist_count,
            albums: u.album_count,
            tracks: u.track_count,
            country: u.country,
        };
    }));
    server.registerTool("lastfm_recent_tracks", {
        title: "Recent tracks",
        description: "Latest scrobbled tracks of a user, most recent first. Defaults to your own account.",
        inputSchema: { user: z.string().min(1).optional(), limit },
    }, ({ user, limit }) => run(async () => {
        const r = await client.call("user.getRecentTracks", {
            user: who(user),
            limit: limit ?? 20,
        });
        return (r.recenttracks.track ?? []).map((t) => {
            const x = t;
            return {
                track: x.name,
                artist: x.artist?.["#text"],
                album: x.album?.["#text"],
                playedAt: x.date?.["#text"] ?? (x["@attr"]?.nowplaying ? "now playing" : undefined),
            };
        });
    }));
    // Last.fm wraps top lists as { topartists: { artist: [...] } }, { topalbums: { album: [...] } }, etc.
    const topTool = (name, method, wrapper, item, title, description, map) => server.registerTool(name, { title, description, inputSchema: { user: z.string().min(1).optional(), period, limit } }, ({ user, period, limit }) => run(async () => {
        const r = await client.call(method, {
            user: who(user),
            period: period ?? "overall",
            limit: limit ?? 20,
        });
        return list(r[wrapper]?.[item]).map(map);
    }));
    topTool("lastfm_top_artists", "user.getTopArtists", "topartists", "artist", "Top artists", "Top artists of a user over a period (overall, 7day, 1month, 3month, 6month, 12month).", (x) => ({
        artist: x.name,
        plays: x.playcount,
        url: x.url,
    }));
    topTool("lastfm_top_albums", "user.getTopAlbums", "topalbums", "album", "Top albums", "Top albums of a user over a period.", (x) => ({
        album: x.name,
        artist: typeof x.artist === "object" ? x.artist?.name : x.artist,
        plays: x.playcount,
    }));
    topTool("lastfm_top_tracks", "user.getTopTracks", "toptracks", "track", "Top tracks", "Top tracks of a user over a period.", (x) => ({
        track: x.name,
        artist: typeof x.artist === "object" ? x.artist?.name : x.artist,
        plays: x.playcount,
    }));
    server.registerTool("lastfm_loved_tracks", {
        title: "Loved tracks",
        description: "Tracks a user has loved on Last.fm.",
        inputSchema: { user: z.string().min(1).optional(), limit },
    }, ({ user, limit }) => run(async () => {
        const r = await client.call("user.getLovedTracks", {
            user: who(user),
            limit: limit ?? 20,
        });
        return (r.lovedtracks.track ?? []).map((t) => {
            const x = t;
            return { track: x.name, artist: x.artist?.name };
        });
    }));
    server.registerTool("lastfm_artist_info", {
        title: "Artist info",
        description: "Info about an artist: listeners, total plays, tags, short bio. Give the artist name, or an mbid.",
        inputSchema: { artist: z.string().min(1), mbid: z.string().optional() },
    }, ({ artist, mbid }) => run(async () => {
        const r = await client.call("artist.getInfo", { artist, mbid, autocorrect: 1 });
        const a = r.artist;
        return {
            name: a.name,
            mbid: a.mbid,
            url: a.url,
            listeners: a.stats?.listeners,
            plays: a.stats?.playcount,
            tags: (a.tags?.tag ?? []).map((t) => t.name),
            bio: a.bio?.summary
                ?.replace(/<[^>]+>/g, "")
                .replace(/\\n|\n/g, " ")
                .split("Read more")[0]
                .trim(),
        };
    }));
    server.registerTool("lastfm_album_info", {
        title: "Album info",
        description: "Info about an album: tracklist, listeners, plays, tags.",
        inputSchema: { artist: z.string().min(1), album: z.string().min(1) },
    }, ({ artist, album }) => run(async () => {
        const r = await client.call("album.getInfo", { artist, album, autocorrect: 1 });
        const a = r.album;
        return {
            album: a.name,
            artist: a.artist,
            url: a.url,
            listeners: a.listeners,
            plays: a.playcount,
            tracks: (a.tracks?.track ?? []).map((t) => t.name),
            tags: (a.tags?.tag ?? []).map((t) => t.name),
        };
    }));
    server.registerTool("lastfm_similar_artists", {
        title: "Similar artists",
        description: "Artists similar to a given artist, with a match score.",
        inputSchema: { artist: z.string().min(1), limit },
    }, ({ artist, limit }) => run(async () => {
        const r = await client.call("artist.getSimilar", {
            artist,
            limit: limit ?? 10,
            autocorrect: 1,
        });
        return (r.similarartists.artist ?? []).map((a) => ({ artist: a.name, match: a.match }));
    }));
    server.registerTool("lastfm_chart_top_artists", {
        title: "Global top artists",
        description: "Global top artists on Last.fm (all users).",
        inputSchema: { limit },
    }, ({ limit }) => run(async () => {
        const r = await client.call("chart.getTopArtists", { limit: limit ?? 20 });
        return list(r.artists.artist).map((x) => ({ artist: x.name, listeners: x.listeners, plays: x.playcount }));
    }));
    return server;
}
async function main() {
    const apiKey = process.env.LASTFM_API_KEY ?? "";
    if (!apiKey) {
        console.error("LASTFM_API_KEY is not set");
        process.exit(1);
    }
    const server = buildServer(new LastfmClient({ apiKey }), process.env.LASTFM_USERNAME || undefined);
    await server.connect(new StdioServerTransport());
}
// Run only when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err instanceof LastfmError ? err.message : err);
        process.exit(1);
    });
}
