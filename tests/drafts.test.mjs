import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyDrafts } from "../scripts/build-drafts.mjs";

const NOW = "2026-11-12T01:00:00.000Z";
const hoursAgo = hours => new Date(Date.parse(NOW) - hours * 60 * 60 * 1000).toISOString();

test("conserve des remplaçants tout en limitant les propositions visibles à quatre", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: String(index), title: "Actualité " + index, url: "https://example.org/" + index,
    summary: "Résumé source " + index, trendScore: 100 - index, publishedAt: hoursAgo(index + 1)
  }));
  const result = buildDailyDrafts(items, NOW);
  assert.equal(result.items.length, 6);
  assert.equal(result.limit, 4);
  assert.equal(result.items.slice(0, 4).length, 4);
  assert.equal(result.items[0].sourceUrl, "https://example.org/0");
  assert.match(result.items[0].text, /Résumé source 0/);
});

test("n’invente pas de contenu lorsque le résumé manque", () => {
  const result = buildDailyDrafts([{
    id: "1", title: "Titre manga", url: "https://example.org/a", summary: "", publishedAt: hoursAgo(1)
  }], NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, "à compléter");
  assert.match(result.items[0].text, /COMPLÉTER APRÈS LECTURE/i);
  assert.match(result.items[0].note, /ne pas publier/i);
});

test("écarte les dates trop anciennes, absentes, invalides ou futures", () => {
  const result = buildDailyDrafts([
    { id: "fresh", title: "Annonce manga récente", url: "https://example.org/fresh", publishedAt: hoursAgo(23) },
    { id: "stale", title: "Annonce manga ancienne", url: "https://example.org/stale", publishedAt: hoursAgo(25) },
    { id: "undated", title: "Annonce manga sans date", url: "https://example.org/undated" },
    { id: "invalid", title: "Annonce manga date invalide", url: "https://example.org/invalid", publishedAt: "pas-une-date" },
    { id: "future", title: "Annonce manga future", url: "https://example.org/future", publishedAt: "2026-11-13T00:00:00.000Z" }
  ], NOW);
  assert.deepEqual(result.items.map(item => item.id), ["fresh"]);
  assert.ok(result.warnings.some(warning => warning.includes("plus de 24 heures")));
  assert.ok(result.warnings.some(warning => warning.includes("sans date")));
  assert.ok(result.warnings.some(warning => warning.includes("date invalide ou future")));
});

test("refuse les liens non HTTPS et dédoublonne", () => {
  const items = [
    { id: "a", title: "Titre", url: "http://example.org/a", summary: "Texte", publishedAt: hoursAgo(1) },
    { id: "b", title: "Titre", url: "https://example.org/b", summary: "Texte", publishedAt: hoursAgo(1) },
    { id: "b", title: "Titre bis", url: "https://example.org/b", summary: "Texte", publishedAt: hoursAgo(1) }
  ];
  assert.equal(buildDailyDrafts(items, NOW).items.length, 1);
});

test("les propositions automatiques restent en français", () => {
  const items = [
    { id: "fr", title: "Annonce manga", url: "https://example.org/fr", summary: "Résumé français", language: "fr", source: "Source FR", publishedAt: hoursAgo(1) },
    { id: "en", title: "Anime news", url: "https://example.org/en", summary: "English summary", language: "en", source: "Source EN", publishedAt: hoursAgo(1) }
  ];
  const result = buildDailyDrafts(items, NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].language, "fr");
});

test("écarte un résultat hors sujet où manga est seulement un nom de lieu", () => {
  const result = buildDailyDrafts([
    { id: "off-topic", title: "Commissariat central de police de Manga : saisie", url: "https://example.org/news", language: "fr", sourceId: "google-news-fr", publishedAt: hoursAgo(1) },
    { id: "on-topic", title: "Un manga adapté en anime", url: "https://example.org/anime", language: "fr", sourceId: "google-news-fr", publishedAt: hoursAgo(1) }
  ], NOW);
  assert.deepEqual(result.items.map(item => item.id), ["on-topic"]);
  assert.ok(result.warnings.some(warning => warning.includes("hors sujet")));
});

test("un résumé qui répète le titre reste à compléter", () => {
  const result = buildDailyDrafts([{
    id: "dup", title: "Le manga Exemple adapté en anime - Média", url: "https://example.org/a",
    summary: "Le manga Exemple adapté en anime Média", language: "fr", source: "Google Actualités", publishedAt: hoursAgo(1)
  }], NOW);
  assert.equal(result.items[0].status, "à compléter");
});


test("un signal provenant uniquement de Google Actualités reste à surveiller", () => {
  const result = buildDailyDrafts([{
    id: "aggregate", title: "Annonce manga récente", url: "https://example.org/a",
    summary: "Résumé français exploitable", language: "fr", sourceId: "google-news-fr",
    source: "Google Actualités", sources: ["Google Actualités"],
    independentSourceCount: 0, coverageSourceCount: 1, trendScore: 90,
    publishedAt: hoursAgo(1)
  }], NOW);
  assert.equal(result.items[0].trendLevel, "surveillance");
  assert.equal(result.items[0].independentSourceCount, 0);
  assert.equal(result.items[0].editorialReady, true);
});

test("une tendance multi-sources passe avant un signal récent isolé", () => {
  const result = buildDailyDrafts([
    { id: "fresh", title: "Sujet récent", url: "https://example.org/fresh",
      summary: "Résumé récent", language: "fr", source: "Google Actualités",
      independentSourceCount: 0, trendScore: 99, publishedAt: hoursAgo(1) },
    { id: "confirmed", title: "Sujet confirmé", url: "https://example.org/confirmed",
      summary: "Résumé confirmé", language: "fr", source: "Média A",
      independentSourceCount: 3, coverageSourceCount: 3, trendScore: 80,
      publishedAt: hoursAgo(3) }
  ], NOW);
  assert.equal(result.items[0].id, "confirmed");
  assert.equal(result.items[0].trendLevel, "spectaculaire");
});

test("sans résumé, la prépublication contient des champs à compléter et reste bloquée", () => {
  const result = buildDailyDrafts([{
    id: "template", title: "Annonce manga", url: "https://example.org/template",
    summary: "", language: "fr", source: "Média", publishedAt: hoursAgo(1)
  }], NOW);
  assert.equal(result.items[0].editorialReady, false);
  assert.equal(result.items[0].status, "à compléter");
  assert.match(result.items[0].text, /Information confirmée par l’article/);
  assert.match(result.items[0].note, /ne pas publier en l’état/i);
});


test("utilise un extrait original anglophone pour une rédaction IA en français sans le déclarer prêt", () => {
  const result = buildDailyDrafts([{
    id: "english-original", title: "Anime announcement from original publisher",
    url: "https://example.org/article", articleUrl: "https://example.org/article",
    summary: "The publisher announced a new anime project and provided production context, the creative team and details about the adaptation for readers.",
    language: "en", articleContentRetrieved: true, summaryOrigin: "metadata_article_original",
    publishedAt: hoursAgo(1), trendScore: 45, independentSourceCount: 1
  }], NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].language, "fr");
  assert.equal(result.items[0].sourceLanguage, "en");
  assert.equal(result.items[0].editorialReady, false);
  assert.match(result.items[0].text, /TRADUCTION FRANÇAISE À GÉNÉRER/i);
  assert.match(result.items[0].note, /média anglophone/i);
});

test("priorise un extrait de média original plutôt qu’un signal Google sans article récupéré", () => {
  const result = buildDailyDrafts([
    { id: "google", title: "Annonce manga spectaculaire", url: "https://news.google.com/rss/articles/a",
      summary: "", language: "fr", sourceId: "google-news-fr", trendScore: 95, publishedAt: hoursAgo(1) },
    { id: "original", title: "New manga adaptation announced", url: "https://publisher.example/article",
      articleUrl: "https://publisher.example/article", summary: "The publisher confirmed a new manga adaptation and shared details about the production and release plans for the project.",
      language: "en", articleContentRetrieved: true, trendScore: 45, independentSourceCount: 1, publishedAt: hoursAgo(2) }
  ], NOW);
  assert.equal(result.items[0].id, "original");
});


test("une tendance multi-sources confirmée prime sur un sujet isolé avec extrait original", () => {
  const result = buildDailyDrafts([
    { id: "isolated", title: "Annonce anime récente", url: "https://solo.example/news",
      summary: "Un extrait original détaillé récupéré auprès d’un média unique.",
      language: "fr", source: "Média unique", articleContentRetrieved: true,
      trendScore: 99, independentSourceCount: 1, publishedAt: hoursAgo(1) },
    { id: "multi", title: "Annonce manga couverte par plusieurs médias", url: "https://multi.example/news",
      summary: "Résumé fourni par plusieurs médias indépendants.",
      language: "fr", source: "Média A", articleContentRetrieved: false,
      trendScore: 78, independentSourceCount: 3, coverageSourceCount: 3,
      publishedAt: hoursAgo(4) }
  ], NOW);
  assert.equal(result.items[0].id, "multi");
  assert.equal(result.items[0].trendLevel, "spectaculaire");
});


test("à niveau égal, une page originale vérifiée prime sur un score isolé plus élevé", () => {
  const result = buildDailyDrafts([
    { id: "score-only", title: "Sujet très récent", url: "https://example.org/score",
      summary: "Résumé RSS exploitable.", language: "fr", source: "Média B",
      independentSourceCount: 1, trendScore: 99, publishedAt: hoursAgo(1),
      sourceVerification: { status: "rss_only_unverified", label: "RSS non vérifié" } },
    { id: "verified", title: "Sujet original vérifié", url: "https://example.org/verified",
      summary: "Extrait détaillé issu de la page originale.", language: "fr", source: "Média A",
      independentSourceCount: 1, trendScore: 55, publishedAt: hoursAgo(5),
      articleContentRetrieved: true,
      sourceVerification: { status: "original_page_excerpt_verified", label: "Extrait original récupéré" } }
  ], NOW);
  assert.equal(result.items[0].id, "verified");
});


test("déclasse les critiques et rétrospectives au profit des actualités", () => {
  const result = buildDailyDrafts([
    { id: "review", title: "Lockdown Life Volume 1 Review", url: "https://example.org/review",
      summary: "A detailed review of the first volume and its characters, with a discussion of the story and artwork.",
      language: "en", articleContentRetrieved: true, independentSourceCount: 1, publishedAt: hoursAgo(1) },
    { id: "concert-recap", title: "LiSA en concert à Paris", url: "https://example.org/concert",
      summary: "LiSA a donné un concert à Paris le 20 septembre. Le spectacle était complet.",
      language: "fr", articleContentRetrieved: true, independentSourceCount: 1, publishedAt: hoursAgo(1) },
    { id: "fresh-news", title: "Nouvelle affiche et date de diffusion annoncées", url: "https://example.org/news",
      summary: "La production a annoncé la date de diffusion en janvier 2027 et dévoilé une nouvelle affiche promotionnelle.",
      language: "fr", articleContentRetrieved: true, independentSourceCount: 1, publishedAt: hoursAgo(2) }
  ], NOW);
  assert.equal(result.items[0].id, "fresh-news");
  assert.ok(result.items.find(item => item.id === "review").editorialFitScore < result.items[0].editorialFitScore);
  assert.ok(result.items.find(item => item.id === "concert-recap").editorialFitScore < result.items[0].editorialFitScore);
});

test("pénalise les articles explicitement sponsorisés dans le classement", () => {
  const result = buildDailyDrafts([
    { id: "sponsored", title: "Débat autour d'un anime", url: "https://example.org/sponsored",
      summary: "Article sponsorisé. Une actualité détaillée sur la série et sa diffusion prochaine.",
      language: "fr", articleContentRetrieved: true, independentSourceCount: 1, publishedAt: hoursAgo(1) },
    { id: "editorial", title: "Annonce d'un nouvel anime", url: "https://example.org/editorial",
      summary: "La production annonce une nouvelle adaptation et dévoile une affiche promotionnelle pour le projet.",
      language: "fr", articleContentRetrieved: true, independentSourceCount: 1, publishedAt: hoursAgo(2) }
  ], NOW);
  assert.equal(result.items[0].id, "editorial");
});


test("ne sacrifie pas les meilleurs sujets pour imposer artificiellement une source différente", () => {
  const result = buildDailyDrafts([
    { id: "best-1", title: "Annonce anime détaillée 1", url: "https://animotaku.example/1",
      summary: "Un extrait original détaillé présente une annonce de production, une nouvelle affiche et des informations utiles sur le projet.",
      language: "fr", source: "AnimOtaku", sources: ["AnimOtaku"], articleContentRetrieved: true,
      sourceVerification: { status: "original_page_excerpt_verified" }, independentSourceCount: 1,
      publishedAt: hoursAgo(1) },
    { id: "best-2", title: "Annonce anime détaillée 2", url: "https://animotaku.example/2",
      summary: "Un autre extrait original détaillé présente une annonce de production, une nouvelle affiche et des informations utiles sur le projet.",
      language: "fr", source: "AnimOtaku", sources: ["AnimOtaku"], articleContentRetrieved: true,
      sourceVerification: { status: "original_page_excerpt_verified" }, independentSourceCount: 1,
      publishedAt: hoursAgo(2) },
    { id: "weak-1", title: "Sujet court", url: "https://other.example/1",
      summary: "Court résumé.", language: "fr", source: "Autre média",
      independentSourceCount: 1, publishedAt: hoursAgo(3) },
    { id: "weak-2", title: "Autre sujet court", url: "https://other.example/2",
      summary: "Résumé bref.", language: "fr", source: "Autre média",
      independentSourceCount: 1, publishedAt: hoursAgo(4) }
  ], NOW);
  assert.deepEqual(result.items.slice(0, 2).map(item => item.id), ["best-1", "best-2"]);
});


test("le contrôle qualité strict n'envoie aucun sujet non éligible à l'IA", () => {
  const now = "2026-11-13T12:00:00.000Z";
  const items = [1, 2, 3, 4, 5].map(number => ({
    id: "quality-" + number,
    title: "Actualité manga " + number,
    url: "https://media.test/" + number,
    summary: "Résumé français suffisamment détaillé pour permettre une rédaction fidèle et contextualisée.",
    publishedAt: now,
    source: "Média spécialisé",
    sourceId: "media-" + number,
    language: "fr"
  }));
  const quality = new Map(items.map((item, index) => [item.id, {
    eligibleForEditorial: index < 2,
    score: index < 2 ? 82 : 45
  }]));
  const result = buildDailyDrafts(items, now, quality);
  assert.equal(result.eligibleCount, 2);
  assert.deepEqual(result.items.map(item => item.id), ["quality-1", "quality-2"]);
  assert.ok(result.warnings.some(warning => warning.includes("Aucun sujet faible")));
});
