import test from "node:test";
import assert from "node:assert/strict";
import { readStoredArray, writeStoredArray } from "../js/storage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    values
  };
}

test("les brouillons restent disponibles après une nouvelle lecture du stockage", () => {
  const storage = memoryStorage();
  const drafts = [{ id: "draft-1", title: "Annonce manga", body: "Texte", hashtags: "#Manga" }];
  assert.equal(writeStoredArray(storage, "drafts", drafts), true);
  assert.deepEqual(readStoredArray(storage, "drafts", "drafts").value, drafts);
});

test("un stockage vide démarre sans brouillon et sans erreur", () => {
  const result = readStoredArray(memoryStorage(), "drafts", "drafts");
  assert.deepEqual(result, { value: [], issue: false, raw: null });
});

test("les données corrompues sont signalées et conservées sans écrasement", () => {
  const raw = "{ données incomplètes";
  const storage = memoryStorage({ drafts: raw });
  const result = readStoredArray(storage, "drafts", "drafts");
  assert.equal(result.issue, true);
  assert.equal(result.raw, raw);
  assert.equal(storage.getItem("drafts"), raw);
});

test("refuse une structure de brouillon invalide", () => {
  const storage = memoryStorage({ drafts: JSON.stringify([{ title: "Sans identifiant" }]) });
  assert.equal(readStoredArray(storage, "drafts", "drafts").issue, true);
});

test("les propositions écartées restent des identifiants texte", () => {
  const storage = memoryStorage();
  assert.equal(writeStoredArray(storage, "dismissed", ["article-1"]), true);
  assert.deepEqual(readStoredArray(storage, "dismissed", "strings").value, ["article-1"]);
});

test("un échec de stockage est signalé sans faire croire à une sauvegarde", () => {
  const storage = { setItem() { throw new Error("quota"); } };
  assert.equal(writeStoredArray(storage, "drafts", []), false);
});
