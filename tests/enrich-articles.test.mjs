import test from "node:test";
import assert from "node:assert/strict";
import { extractArticleText, safeArticleUrl, enrichItems, resolvePublisherUrl } from "../scripts/enrich-articles.mjs";

test("extrait une description éditoriale depuis les métadonnées HTML", () => {
  const html = '<html><head><meta property="og:description" content="Une annonce officielle concernant une nouvelle adaptation anime, avec des informations de contexte utiles aux lecteurs et plusieurs précisions de production."></head></html>';
  assert.match(extractArticleText(html), /annonce officielle/);
});

test("préfère le contenu structuré ou le texte de l’article aux métadonnées", () => {
  const html = '<html><head><meta name="description" content="Résumé court du média, avec assez de texte pour être exploitable mais moins détaillé que le contenu de l’article lui-même."></head><body><article><p>Le média présente une annonce officielle et détaille le contexte éditorial, les personnes concernées, les informations confirmées et les précisions disponibles pour les lecteurs. Ce contenu provient du corps de la page source.</p></article></body></html>';
  assert.match(extractArticleText(html), /corps de la page source/);
});

test("refuse les URL non HTTPS, les destinations locales et les agrégateurs Google", () => {
  assert.equal(safeArticleUrl("http://example.org/article"), null);
  assert.equal(safeArticleUrl("https://127.0.0.1/private"), null);
  assert.equal(safeArticleUrl("https://localhost/article"), null);
  assert.equal(safeArticleUrl("https://news.google.com/rss/articles/example"), null);
  assert.ok(safeArticleUrl("https://example.org/article"));
});

test("rejette les descriptions génériques Google même si elles sont longues", () => {
  const html = '<html><head><meta name="description" content="Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News. This is only a generic aggregator page and not the original publisher article."></head></html>';
  assert.equal(extractArticleText(html), "");
});

test("enrichit un article depuis le domaine original et conserve les données RSS", async () => {
  const fetchImpl = async (url) => new Response(
    '<html><head><meta name="description" content="Une annonce officielle révèle une adaptation en anime. Les détails de production et les informations complémentaires sont présentés dans la page source, avec un contexte éditorial utile aux lecteurs."></head></html>',
    { status: 200, headers: { "content-type": "text/html", "content-length": "260" } }
  );
  const input = [{ id: "a", title: "Un manga adapté en anime", url: "https://example.org/article", summary: "" }];
  const result = await enrichItems(input, { fetchImpl, maxPages: 1 });
  assert.equal(result.attempted, 1);
  assert.equal(result.enriched, 1);
  assert.match(result.items[0].summary, /annonce officielle/);
  assert.equal(result.items[0].articleContentRetrieved, true);
  assert.equal(result.items[0].url, "https://example.org/article");
  assert.equal(result.items[0].articleUrl, "https://example.org/article");
});

test("n’attribue jamais un extrait Google générique à un article original", async () => {
  let calls = 0;
  const result = await enrichItems([{ id: "g", title: "Actualité manga", url: "https://news.google.com/rss/articles/abc", summary: "" }], {
    maxPages: 1,
    fetchImpl: async () => { calls += 1; return new Response("<html><body>Google News</body></html>", { status: 200, headers: { "content-type": "text/html" } }); }
  });
  assert.equal(calls, 1);
  assert.equal(result.enriched, 0);
  assert.equal(result.skippedAggregator, 1);
  assert.equal(result.items[0].articleContentRetrieved, undefined);
  assert.match(result.items[0].articleFetchNote, /média d’origine non résolu/);
});

test("ne lit pas une page HTML trop volumineuse", async () => {
  const huge = new Uint8Array(1_200_001);
  const response = new Response(huge, { status: 200, headers: { "content-type": "text/html" } });
  const result = await enrichItems([{ id: "large", title: "Annonce manga", url: "https://example.org/large", summary: "" }], {
    maxPages: 1, fetchImpl: async () => response
  });
  assert.equal(result.enriched, 0);
  assert.notEqual(result.items[0].articleContentRetrieved, true);
});

test("résout une redirection Google Actualités vers le domaine du média", async () => {
  let calls = 0;
  const resolved = await resolvePublisherUrl(async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 302, headers: { location: "https://publisher.example/news/manga" } })
      : new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  }, "https://news.google.com/rss/articles/example");
  assert.equal(resolved, "https://publisher.example/news/manga");
});

test("refuse une redirection Google Actualités vers une destination locale", async () => {
  const resolved = await resolvePublisherUrl(async () => new Response(null, {
    status: 302, headers: { location: "https://127.0.0.1/private" }
  }), "https://news.google.com/rss/articles/example");
  assert.equal(resolved, null);
});

test("enrichit un lien Google uniquement après résolution du média d’origine", async () => {
  const calls = [];
  const result = await enrichItems([{
    id: "google-resolved", title: "Une annonce manga", url: "https://news.google.com/rss/articles/example",
    summary: "", language: "fr"
  }], {
    maxPages: 1,
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.startsWith("https://news.google.com/")) {
        return new Response(null, { status: 302, headers: { location: "https://publisher.example/article" } });
      }
      return new Response('<html><head><meta name="description" content="Le média annonce une nouvelle adaptation manga et présente les informations confirmées, les détails éditoriaux et le contexte utile aux lecteurs dans son article original."></head></html>', {
        status: 200, headers: { "content-type": "text/html" }
      });
    }
  });
  assert.equal(result.enriched, 1);
  assert.equal(result.skippedAggregator, 0);
  assert.equal(result.items[0].articleUrl, "https://publisher.example/article");
  assert.equal(result.items[0].sourceVerification.status, "original_page_excerpt_verified");
  assert.equal(result.items[0].sourceVerification.publisherHost, "publisher.example");
  assert.equal(calls.length, 3);
});


test("résout une page intermédiaire Google Actualités qui contient un lien éditeur", async () => {
  let calls = 0;
  const resolved = await resolvePublisherUrl(async () => {
    calls += 1;
    return new Response('<html><body><a data-n-au="https://publisher.example/manga/article">Lire l’article</a></body></html>', {
      status: 200, headers: { "content-type": "text/html" }
    });
  }, "https://news.google.com/rss/articles/example");
  assert.equal(resolved, "https://publisher.example/manga/article");
  assert.equal(calls, 1);
});

test("ignore les liens intermédiaires Google vers une destination non sûre", async () => {
  const resolved = await resolvePublisherUrl(async () => new Response(
    '<html><body><a href="https://127.0.0.1/private">Continuer</a></body></html>',
    { status: 200, headers: { "content-type": "text/html" } }
  ), "https://news.google.com/rss/articles/example");
  assert.equal(resolved, null);
});


test("ne considère jamais gstatic comme le média éditeur", async () => {
  const resolved = await resolvePublisherUrl(async () => new Response("<html><body>Intermediate Google page</body></html>", {
    status: 200, headers: { "content-type": "text/html" }
  }), "https://news.google.com/rss/articles/example");
  assert.equal(resolved, null);
});

test("ignore les liens Google infrastructure et continue vers un lien éditeur", async () => {
  const resolved = await resolvePublisherUrl(async () => new Response(
    '<html><body><a href="https://www.gstatic.com/redirect">Google</a><a href="https://publisher.example/article">Publisher</a></body></html>',
    { status: 200, headers: { "content-type": "text/html" } }
  ), "https://news.google.com/rss/articles/example");
  assert.equal(resolved, "https://publisher.example/article");
});


test("ignore les domaines Google Analytics et de suivi comme médias éditeurs", async () => {
  const resolved = await resolvePublisherUrl(async () => new Response(
    '<html><body><a href="https://www.google-analytics.com/analytics.js">Analytics</a><a href="https://www.googletagmanager.com/gtm.js">Tag Manager</a><a href="https://publisher.example/article">Publisher</a></body></html>',
    { status: 200, headers: { "content-type": "text/html" } }
  ), "https://news.google.com/rss/articles/example");
  assert.equal(resolved, "https://publisher.example/article");
});

test("ne renvoie jamais une URL Google Analytics comme média d’origine", async () => {
  const resolved = await resolvePublisherUrl(async () => new Response(null, {
    status: 302, headers: { location: "https://www.google-analytics.com/analytics.js" }
  }), "https://news.google.com/rss/articles/example");
  assert.equal(resolved, null);
});
