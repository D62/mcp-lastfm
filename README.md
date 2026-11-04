# mcp-lastfm

Local MCP server (stdio) for the Last.fm API. Read-only.

## Install (run the server)

Tested with Node.js v26. Other versions are not checked yet.

```
npm ci --omit=dev
```

`dist/` is committed, so there is no build step. Run the server with:

```
LASTFM_API_KEY=your-key LASTFM_USERNAME=your-username node dist/index.js
```

Environment variables:

- `LASTFM_API_KEY` (required): your Last.fm API key. Create one at https://www.last.fm/api/account/create.
- `LASTFM_USERNAME` (optional): your own username. Used as the default when a tool has no `user` argument.

To use it from an MCP client, point the client at `node /absolute/path/to/mcp-lastfm/dist/index.js` and pass these variables in its `env`. Never commit the key.

## Tools

Any user (pass `user`), or your own account when `LASTFM_USERNAME` is set:

- `lastfm_get_user`: profile and totals (scrobbles, artists, albums, tracks).
- `lastfm_recent_tracks`: latest scrobbles.
- `lastfm_top_artists`: top artists over a period (`overall`, `7day`, `1month`, `3month`, `6month`, `12month`).
- `lastfm_top_albums`: top albums over a period.
- `lastfm_top_tracks`: top tracks over a period.
- `lastfm_loved_tracks`: loved tracks.
- `lastfm_artist_chart_between`: top artists between two dates (`from`, optional `to`, `YYYY-MM-DD`, UTC, inclusive). Use it for a calendar year, for example `from: 2026-01-01`. The period tools above only go back 12 months.

Music data (no account needed):

- `lastfm_artist_info`: listeners, plays, tags, short bio.
- `lastfm_album_info`: tracklist, listeners, plays, tags.
- `lastfm_similar_artists`: similar artists with a match score.
- `lastfm_chart_top_artists`: global top artists.

## Capabilities and limits

- **Read-only.** No tool scrobbles, loves, or changes anything on Last.fm. Writes need a signed session, which this server does not implement.
- **No user search.** The API has no way to list or search all users. You need the exact username.
- **Periods can be empty.** A user with no scrobbles in a period gets an empty list, not an error.
- **Calendar periods.** `lastfm_top_*` only take rolling periods (up to 12 months). For a calendar year or a custom range, use `lastfm_artist_chart_between`, which covers artists only.
- **Unknown users and artists** return a "not found" error.
- **Rate limit.** Last.fm asks for at most about 5 requests per second. The client waits 250 ms between requests.

## Development

Source is in `src/` (TypeScript). `dist/` is the compiled output, and it is committed.

```
npm ci              # all dependencies, including TypeScript
npm run build       # compile src/ to dist/
npm test            # unit tests, mocked HTTP
```

Before every commit that changes `src/`:

1. `npm run build`
2. `npm test`
3. commit `src/`, `test/` and `dist/` together.

If `dist/` is out of date, the server runs old code.

## Status

- Unit tests pass with mocked HTTP (8 tests).
- Live checks: profile, recent tracks, top artists (empty for the last month, correct for that account), artist info, similar artists, global chart, the not-found error, and the artist chart for 2026.
