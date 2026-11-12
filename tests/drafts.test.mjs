import test from "node:test";
import assert from "node:assert/strict";
import {buildDailyDrafts} from "../scripts/build-drafts.mjs";

test("conserve des remplaçants tout en fixant quatre propositions visibles", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    title: "Actualité " + i,
    url: "https://example.org/" + i,
    summary: "Résumé source " + i,
    trendScore: 100 - i
  }));
  const result = buildDailyDrafts(items, "2026-11-12T00:00:00.000Z");
  assert.equal(result.items.length, 6);
  assert.equal(result.limit, 4);
  assert.equal(result.items.slice(0, 4).length, 4);
  assert.equal(result.items[0].sourceUrl, "https://example.org/0");
  assert.match(result.items[0].text, /Résumé source 0/);
});

test("ne fabrique pas quatre sujets si les sources sont insuffisantes", () => {
  const result = buildDailyDrafts([{ id: "1", title: "Titre", url: "https://example.org/a", summary: "" }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.items[0].status, "à compléter");
  assert.equal(result.warnings.length, 1);
});

test("refuse les liens non HTTPS et dédoublonne", () => {
  const items = [
    { id: "a", title: "Titre", url: "http://example.org/a", summary: "Texte" },
    { id: "b", title: "Titre", url: "https://example.org/b", summary: "Texte" },
    { id: "b", title: "Titre bis", url: "https://example.org/b", summary: "Texte" }
  ];
  assert.equal(buildDailyDrafts(items).items.length, 1);
});

test("les propositions automatiques restent en français", () => {
  const items = [
    { id: "fr", title: "Annonce manga", url: "https://example.org/fr", summary: "Résumé français", language: "fr", source: "Source FR" },
    { id: "en", title: "Anime news", url: "https://example.org/en", summary: "English summary", language: "en", source: "Source EN" }
  ];
  const result = buildDailyDrafts(items);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].language, "fr");
});

test("un extrait qui répète seulement le titre est marqué à compléter", () => {
  const result = buildDailyDrafts([
    { id: "dup", title: "Le manga Exemple adapté en anime - Média", url: "https://example.org/a", summary: "Le manga Exemple adapté en anime Média", language: "fr", source: "Google Actualités" }
  ]);
  assert.equal(result.items[0].status, "à compléter");
  assert.match(result.items[0].note, /pas de résumé distinct|ne fournit pas de résumé distinct/i);
});

test("les sources manquantes ne cassent pas le générateur", () => {
  const result = buildDailyDrafts([
    { id: "source-missing", title: "Manga sans résumé détaillé", url: "https://example.org/source-missing", summary: "", language: "fr" }
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, "à compléter");
  assert.match(result.items[0].sourceNames[0] || "", /source/i);
});

