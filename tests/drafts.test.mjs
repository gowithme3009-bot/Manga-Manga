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
  assert.match(result.items[0].text, /À compléter après lecture/);
  assert.match(result.items[0].note, /Ne pas publier/);
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
