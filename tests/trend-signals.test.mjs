import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEntityText, matchCatalogEntity, parseGoogleTrendsFeed } from "../scripts/collect-search-trends.mjs";

const catalog = [
  { id: "anime-1", name: "One Piece", type: "anime", aliases: ["One Piece", "ワンピース"] },
  { id: "manga-2", name: "Frieren: Beyond Journey's End", type: "manga", aliases: ["Frieren", "Sousou no Frieren"] }
];

test("normalise les accents et variantes de ponctuation", () => {
  assert.equal(normalizeEntityText("Frieren : Beyond Journey’s End"), "frieren beyond journey s end");
});

test("reconnaît un titre manga ou anime sans accepter une sous-chaîne partielle", () => {
  assert.equal(matchCatalogEntity("One Piece devient tendance", catalog)?.id, "anime-1");
  assert.equal(matchCatalogEntity("Sousou no Frieren", catalog)?.id, "manga-2");
  assert.equal(matchCatalogEntity("someone piece of news", catalog), null);
});

test("extrait uniquement les recherches Google Trends correspondant au catalogue", () => {
  const xml = `<rss><channel>
    <item><title>One Piece</title><ht:approx_traffic>2000+</ht:approx_traffic><pubDate>Wed, 12 Nov 2026 06:00:00 GMT</pubDate><link>https://trends.google.com/trending?geo=FR</link></item>
    <item><title>Football</title><ht:approx_traffic>10000+</ht:approx_traffic><pubDate>Wed, 12 Nov 2026 06:00:00 GMT</pubDate><link>https://example.org</link></item>
  </channel></rss>`;
  const result = parseGoogleTrendsFeed(xml, { code: "FR", label: "France" }, catalog, Date.parse("2026-11-12T07:00:00Z"));
  assert.equal(result.length, 1);
  assert.equal(result[0].entityName, "One Piece");
  assert.equal(result[0].approximateTraffic, "2000+");
  assert.equal(result[0].signalType, "recherche publique agrégée");
});
