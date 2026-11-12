import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEntityText, matchCatalogEntity, matchCatalogEntities, buildEditorialSignals, parseGoogleTrendsFeed, fetchAniListCatalog } from "../scripts/collect-search-trends.mjs";

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

test("reconnaît plusieurs titres distincts et conserve l'alias correspondant", () => {
  const extended = [
    ...catalog,
    { id: "anime-3", name: "Mashle", type: "anime", aliases: ["Mashle", "Mashle: Magic and Muscles"] }
  ];
  const matches = matchCatalogEntities("Mashle et Sousou no Frieren font parler d'eux", extended);
  assert.deepEqual(matches.map(item => item.id).sort(), ["anime-3", "manga-2"]);
});

test("évite de confondre un titre court avec une œuvre au nom plus long", () => {
  const extended = [
    { id: "manga-berserk", name: "Berserk", type: "manga", aliases: ["Berserk"] },
    { id: "manga-berserk-gluttony", name: "Berserk of Gluttony", type: "manga", aliases: ["Berserk of Gluttony"] }
  ];
  const matches = matchCatalogEntities("Berserk of Gluttony révèle sa saison 2", extended);
  assert.deepEqual(matches.map(item => item.id), ["manga-berserk-gluttony"]);
  const generic = matchCatalogEntities("The Man in the White Coat annonce une nouveauté", [
    { id: "manga-mans-man", name: "A Man's Man", type: "manga", aliases: ["The Man", "A Man's Man"] }
  ]);
  assert.equal(generic.length, 0);
});

test("construit des mentions RSS sans confondre les agrégateurs avec des médias directs", () => {
  const mentions = buildEditorialSignals([
    { id: "a", title: "Mashle annonce une nouveauté", summary: "Le manga revient", url: "https://ann.test/a", source: "Anime News Network", sourceId: "anime-news-network", sources: ["Anime News Network"], sourceIds: ["anime-news-network"], publishedAt: "2026-11-12T06:00:00Z" },
    { id: "b", title: "Mashle : nouvelle annonce", summary: "", url: "https://news.google.com/b", source: "Google Actualités", sourceId: "google-news-fr", sources: ["Google Actualités"], sourceIds: ["google-news-fr"], publishedAt: "2026-11-12T05:00:00Z" },
    { id: "c", title: "Mashle revient", summary: "", url: "https://corner.test/c", source: "Anime Corner", sourceId: "anime-corner", sources: ["Anime Corner"], sourceIds: ["anime-corner"], publishedAt: "2026-11-12T04:00:00Z" }
  ], [...catalog, { id: "anime-3", name: "Mashle", type: "anime", aliases: ["Mashle"] }]);
  const mashle = mentions.find(item => item.entityId === "anime-3");
  assert.equal(mashle.articleCount, 3);
  assert.equal(mashle.sourceCount, 2);
  assert.equal(mashle.articles.length, 3);
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


test("actualise plusieurs pages AniList et conserve les titres cliquables et alias", async () => {
  const requests = [];
  const fakeFetch = async (_url, options) => {
    const query = JSON.parse(options.body).query;
    requests.push(query);
    const type = query.includes("type: ANIME") ? "ANIME" : "MANGA";
    return {
      ok: true,
      json: async () => ({
        data: { Page: { media: [{
          id: type === "ANIME" ? 101 : 202,
          title: { romaji: "Titre Romaji", english: "English Title", native: "日本語" },
          synonyms: ["Alias français"],
          popularity: 5000,
          trending: 250,
          format: "TV",
          genres: ["Action"],
          siteUrl: "https://anilist.co/" + type.toLowerCase() + "/" + (type === "ANIME" ? 101 : 202)
        }] } }
      })
    };
  };
  const catalog = await fetchAniListCatalog(fakeFetch, 2);
  assert.equal(requests.length, 4);
  assert.equal(catalog.length, 2);
  assert.ok(catalog.some(item => item.type === "anime" && item.aliases.includes("Alias français")));
  assert.ok(catalog.every(item => item.url.startsWith("https://anilist.co/")));
});
