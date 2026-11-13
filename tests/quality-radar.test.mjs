import test from "node:test";
import assert from "node:assert/strict";
import { buildQualityRadar } from "../scripts/build-quality-radar.mjs";

const now = "2026-11-13T12:00:00.000Z";
const verified = (id, source, hours = 2) => ({
  id, title: "Annonce manga " + id, url: "https://" + source + ".test/" + id,
  articleUrl: "https://" + source + ".test/" + id,
  summary: "Une information détaillée et vérifiable sur une annonce officielle, avec contexte, noms confirmés, calendrier et éléments utiles pour comprendre cette actualité. ".repeat(3),
  publishedAt: new Date(Date.parse(now) - hours * 3600000).toISOString(),
  source, sourceId: source, sources: [source], sourceIds: [source],
  sourceVerification: { status: "original_page_excerpt_verified" },
  articleContentRetrieved: true
});

test("sépare les articles de qualité et les signaux de titres sans confondre le catalogue avec une actualité", () => {
  const news = [verified("a", "media-a"), verified("b", "media-b"), {
    id: "weak", title: "Rumeur sans source", url: "https://unknown.test/weak",
    summary: "Une phrase très courte", publishedAt: now, source: "Google Actualités",
    sourceId: "google-news-fr", sources: ["Google Actualités"], sourceIds: ["google-news-fr"]
  }];
  const trends = {
    catalogItems: [{ id: "manga-1", name: "Titre A", type: "manga", trending: 100, url: "https://anilist.co/manga/1" }],
    items: [{ entityId: "manga-1", title: "Titre A", country: "FR" }],
    mentions: [{
      entityId: "manga-1", entityName: "Titre A", entityType: "manga",
      articleCount: 2, sourceCount: 2, latestAt: now,
      articles: [
        { title: "Annonce a", url: "https://media-a.test/a", publishedAt: news[0].publishedAt, sources: ["media-a"] },
        { title: "Annonce b", url: "https://media-b.test/b", publishedAt: news[1].publishedAt, sources: ["media-b"] }
      ]
    }]
  };
  const result = buildQualityRadar(news, trends, now);
  assert.equal(result.siteTrends.length, 3);
  assert.equal(result.siteTrends.find(item => item.id === "weak").eligibleForEditorial, false);
  assert.equal(result.entityTrends[0].confirmed, true);
  assert.equal(result.entityTrends[0].strong, false);
  assert.equal(result.confirmedEntities.length, 1);
});

test("une répétition par un seul média ne confirme jamais une tendance", () => {
  const result = buildQualityRadar([], {
    mentions: [{
      entityId: "anime-2", entityName: "Titre B", entityType: "anime",
      articleCount: 3, sourceCount: 1, latestAt: now,
      articles: [
        { title: "Article 1", url: "https://same.test/1", publishedAt: now, sources: ["same.test"] },
        { title: "Article 2", url: "https://same.test/2", publishedAt: now, sources: ["same.test"] },
        { title: "Article 3", url: "https://same.test/3", publishedAt: now, sources: ["same.test"] }
      ]
    }]
  }, now);
  assert.equal(result.entityTrends[0].confirmed, false);
  assert.ok(result.entityTrends[0].reasons.includes("Moins de deux médias indépendants"));
});


test("deux médias indépendants récents peuvent confirmer une tendance sans signal AniList ni Google Trends", () => {
  const news = [verified("one", "source-one"), verified("two", "source-two")];
  const trends = {
    mentions: [{
      entityId: "anime-3", entityName: "Titre C", entityType: "anime",
      articleCount: 2, sourceCount: 2, latestAt: now,
      articles: news.map(item => ({
        title: item.title, url: item.url, publishedAt: item.publishedAt, sources: item.sources
      }))
    }]
  };
  const result = buildQualityRadar(news, trends, now);
  assert.equal(result.entityTrends[0].independentSourceCount, 2);
  assert.equal(result.entityTrends[0].recentArticleCount, 2);
  assert.equal(result.entityTrends[0].searchSignalCount, 0);
  assert.equal(result.entityTrends[0].confirmed, true);
  assert.equal(result.entityTrends[0].strong, false);
});

test("les articles anciens ne gonflent pas le nombre de médias indépendants récents", () => {
  const oldDate = new Date(Date.parse(now) - 5 * 24 * 3600000).toISOString();
  const news = [verified("fresh-one", "source-one"), verified("fresh-two", "source-one")];
  const trends = {
    mentions: [{
      entityId: "anime-4", entityName: "Titre D", entityType: "anime",
      articleCount: 3, sourceCount: 2, latestAt: now,
      articles: [
        ...news.map(item => ({ title: item.title, url: item.url, publishedAt: item.publishedAt, sources: item.sources })),
        { title: "Ancien article", url: "https://source-two.test/old", publishedAt: oldDate, sources: ["source-two"] }
      ]
    }]
  };
  const result = buildQualityRadar(news, trends, now);
  assert.equal(result.entityTrends[0].independentSourceCount, 1);
  assert.equal(result.entityTrends[0].confirmed, false);
});


test("un article fiable seul reste hors prépublication tant que sa tendance n'est pas confirmée", () => {
  const news = [verified("solo", "single-source")];
  const trends = {
    mentions: [{
      entityId: "anime-5", entityName: "Titre E", entityType: "anime",
      articleCount: 1, sourceCount: 1, latestAt: now,
      articles: [{ title: news[0].title, url: news[0].url, publishedAt: news[0].publishedAt, sources: ["single-source"] }]
    }]
  };
  const result = buildQualityRadar(news, trends, now);
  const article = result.siteTrends[0];
  assert.equal(article.articleQualityEligible, true);
  assert.equal(article.trendConfirmed, false);
  assert.equal(article.eligibleForEditorial, false);
  assert.equal(result.summary.editorialEligibleSites, 0);
});
