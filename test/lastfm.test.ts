import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LastfmClient, LastfmError, type FetchLike } from "../src/client.js";
import { buildServer } from "../src/index.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const KEY = "TESTKEY123";

async function connect(fetchImpl: FetchLike, defaultUser?: string) {
  const client = new LastfmClient({ apiKey: KEY, fetchImpl, minIntervalMs: 0 });
  const server = buildServer(client, defaultUser);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  return mcp;
}

const textOf = (r: any) => (r.content as { text: string }[])[0].text;

test("client sends method, key and format, and drops empty params", async () => {
  let seen = "";
  const c = new LastfmClient({
    apiKey: KEY,
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      seen = url;
      return json({ ok: true });
    },
  });
  await c.call("user.getInfo", { user: "alice", limit: undefined, period: "" });
  const u = new URL(seen);
  assert.equal(u.searchParams.get("method"), "user.getInfo");
  assert.equal(u.searchParams.get("api_key"), KEY);
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(u.searchParams.get("user"), "alice");
  assert.equal(u.searchParams.has("limit"), false);
  assert.equal(u.searchParams.has("period"), false);
});

test("client turns Last.fm error bodies into errors, without leaking the key", async () => {
  const mk = (body: unknown, status = 200) =>
    new LastfmClient({ apiKey: KEY, minIntervalMs: 0, fetchImpl: async () => json(body, status) });
  await assert.rejects(mk({ error: 6, message: "User not found" }).call("user.getInfo"), (e: LastfmError) => {
    assert.equal(e.code, 6);
    assert.match(e.message, /User not found/);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
  await assert.rejects(mk({ error: 10, message: "Invalid API key" }).call("x"), (e: LastfmError) => e.code === 10 && /API key/.test(e.message));
  await assert.rejects(mk({ error: 29, message: "Rate limit" }).call("x"), (e: LastfmError) => e.code === 29);
  await assert.rejects(mk({}, 503).call("x"), (e: LastfmError) => e.code === 503);
  await assert.rejects(mk({}, 404).call("user.getInfo"), (e: LastfmError) => e.code === 404 && /Not found/.test(e.message));
});

test("client refuses to start without a key", () => {
  assert.throws(() => new LastfmClient({ apiKey: "" }));
});

test("tool list is read-only", async () => {
  const mcp = await connect(async () => json({}));
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "lastfm_album_info",
    "lastfm_artist_info",
    "lastfm_chart_top_artists",
    "lastfm_get_user",
    "lastfm_loved_tracks",
    "lastfm_recent_tracks",
    "lastfm_similar_artists",
    "lastfm_top_albums",
    "lastfm_top_artists",
    "lastfm_top_tracks",
  ]);
  assert.ok(tools.every((t) => !/scrobble|love_|unlove|add|delete|write/i.test(t.name)));
  await mcp.close();
});

test("top artists use the default user when none is given, and summarize", async () => {
  const calls: string[] = [];
  const mcp = await connect(async (url) => {
    calls.push(url);
    return json({
      topartists: {
        artist: [{ name: "Jamiroquai", playcount: "1200", url: "https://www.last.fm/music/Jamiroquai" }],
      },
    });
  }, "defaultuser");
  const r = await mcp.callTool({ name: "lastfm_top_artists", arguments: { period: "1month", limit: 5 } });
  assert.match(textOf(r), /"artist": "Jamiroquai"/);
  assert.match(textOf(r), /"plays": "1200"/);
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get("user"), "defaultuser");
  assert.equal(u.searchParams.get("period"), "1month");
  assert.equal(u.searchParams.get("limit"), "5");
  await mcp.close();
});

test("a user argument overrides the default, and a missing user is an error", async () => {
  const calls: string[] = [];
  const mcp = await connect(async (url) => {
    calls.push(url);
    return json({ recenttracks: { track: [{ name: "Cosmic Girl", artist: { "#text": "Jamiroquai" }, date: { "#text": "04 Nov 2026" } }] } });
  });
  const none = await mcp.callTool({ name: "lastfm_recent_tracks", arguments: {} });
  assert.equal(none.isError, true);
  assert.equal(calls.length, 0);

  const r = await mcp.callTool({ name: "lastfm_recent_tracks", arguments: { user: "someone" } });
  assert.match(textOf(r), /Cosmic Girl/);
  assert.equal(new URL(calls[0]).searchParams.get("user"), "someone");
  await mcp.close();
});

test("API errors come back as tool errors", async () => {
  const mcp = await connect(async () => json({ error: 6, message: "User not found" }));
  const r = await mcp.callTool({ name: "lastfm_get_user", arguments: { user: "nobody" } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /User not found/);
  await mcp.close();
});
