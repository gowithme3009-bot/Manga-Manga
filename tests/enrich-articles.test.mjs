import test from "node:test";
import assert from "node:assert/strict";
import { extractArticleText, safeArticleUrl, enrichItems } from "../scripts/enrich-articles.mjs";

test("extrait une description éditoriale depuis les métadonnées HTML", () => {
  const html = '<html><head><meta property="og:description" content="Une annonce officielle concernant une nouvelle adaptation anime, avec des informations de contexte utiles aux lecteurs."></head></html>';
  assert.match(extractArticleText(html), /annonce officielle/);
});

test("refuse les URL non HTTPS et les destinations locales", () => {
  assert.equal(safeArticleUrl("http://example.org/article"), null);
  assert.equal(safeArticleUrl("https://127.0.0.1/private"), null);
  assert.equal(safeArticleUrl("https://localhost/article"), null);
  assert.ok(safeArticleUrl("https://example.org/article"));
});

test("enrichit un article avec un extrait original et conserve les données RSS", async () => {
  const fetchImpl = async () => new Response(
    '<html><head><meta name="description" content="Une annonce officielle révèle une adaptation en anime. Les détails de production et les informations complémentaires sont présentés dans la page source."></head></html>',
    { status: 200, headers: { "content-type": "text/html", "content-length": "220" } }
  );
  const input = [{ id: "a", title: "Un manga adapté en anime", url: "https://example.org/rss", summary: "" }];
  const result = await enrichItems(input, { fetchImpl, maxPages: 1 });
  assert.equal(result.attempted, 1);
  assert.equal(result.enriched, 1);
  assert.match(result.items[0].summary, /annonce officielle/);
  assert.equal(result.items[0].articleContentRetrieved, true);
  assert.equal(result.items[0].url, "https://example.org/rss");
  assert.equal(result.items[0].articleUrl, "https://example.org/rss");
});
