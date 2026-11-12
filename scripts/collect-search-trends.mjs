import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANILIST_URL = "https://graphql.anilist.co";
const GOOGLE_TRENDS_URL = "https://trends.google.com/trending/rss?geo=";
const TIMEOUT_MS = 12000;
const COUNTRIES = [
  { code: "FR", label: "France" },
  { code: "JP", label: "Japon" }
];

export function normalizeEntityText(value = "") {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function matchCatalogEntity(term, catalog) {
  const normalized = normalizeEntityText(term);
  if (!normalized) return null;
  const padded = " " + normalized + " ";
  for (const entity of catalog || []) {
    for (const alias of entity.aliases || []) {
      const candidate = normalizeEntityText(alias);
      if (candidate.length < 4) continue;
      if (padded.includes(" " + candidate + " ")) return entity;
    }
  }
  return null;
}

function decode(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const escaped = name.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp("<" + escaped + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + escaped + "\\s*>", "i"));
  return match ? decode(match[1]) : "";
}
function timeoutFetch(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetchImpl(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export function parseGoogleTrendsFeed(xml, country, catalog, now = Date.now()) {
  const blocks = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  const signals = [];
  for (const match of blocks) {
    const block = match[1];
    const title = tag(block, "title");
    const entity = matchCatalogEntity(title, catalog);
    if (!entity) continue;
    const traffic = tag(block, "ht:approx_traffic");
    const dateRaw = tag(block, "pubDate");
    const date = Date.parse(dateRaw);
    const link = tag(block, "link");
    const publishedAt = Number.isFinite(date) ? new Date(date).toISOString() : new Date(now).toISOString();
    const id = crypto.createHash("sha256").update(country.code + ":" + entity.id + ":" + title).digest("hex").slice(0, 20);
    signals.push({
      id, title, entityId: entity.id, entityName: entity.name, entityType: entity.type,
      country: country.code, countryLabel: country.label, approximateTraffic: traffic || null,
      publishedAt, url: "https://trends.google.com/trending?geo=" + country.code,
      source: "Google Trends", signalType: "recherche publique agrégée",
      note: "Tendance de recherche publique dans cette région ; le volume est une estimation par tranche, pas un nombre exact."
    });
  }
  return signals;
}

export async function fetchAniListCatalog(fetchImpl = fetch) {
  const query = `query {
    anime: Page(page: 1, perPage: 50) {
      media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
        id
        title { romaji english native }
        synonyms
      }
    }
    manga: Page(page: 1, perPage: 50) {
      media(type: MANGA, sort: TRENDING_DESC, isAdult: false) {
        id
        title { romaji english native }
        synonyms
      }
    }
  }`;
  const response = await timeoutFetch(fetchImpl, ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error("AniList HTTP " + response.status);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message || "Erreur AniList");
  const catalog = [];
  for (const type of ["anime", "manga"]) {
    for (const media of payload.data?.[type]?.media || []) {
      const aliases = [...new Set([
        media.title?.romaji, media.title?.english, media.title?.native, ...(media.synonyms || [])
      ].filter(value => typeof value === "string" && value.trim()))];
      if (!aliases.length) continue;
      catalog.push({
        id: type + "-" + media.id,
        name: media.title?.english || media.title?.romaji || aliases[0],
        type: type === "anime" ? "anime" : "manga",
        aliases
      });
    }
  }
  return catalog;
}

export async function collectSearchTrends({
  fetchImpl = fetch, countries = COUNTRIES, now = Date.now(),
  outputPath = path.join(ROOT, "data/trend-signals.json")
} = {}) {
  const warnings = ["Google Trends ne propose pas de flux RSS Madagascar (MG) dans cette collecte ; aucune donnée locale n’est supposée."];
  let catalog = [];
  try {
    catalog = await fetchAniListCatalog(fetchImpl);
  } catch (error) {
    warnings.push("Catalogue AniList indisponible : " + error.message);
  }
  const signals = [];
  const sources = [];
  for (const country of countries) {
    try {
      const response = await timeoutFetch(fetchImpl, GOOGLE_TRENDS_URL + country.code, {
        headers: { "User-Agent": "Manga-Manga-Studio/0.1", "Accept": "application/rss+xml, application/xml, text/xml" }
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const xml = await response.text();
      const found = parseGoogleTrendsFeed(xml, country, catalog, now);
      signals.push(...found);
      sources.push({ id: "google-trends-" + country.code.toLowerCase(), name: "Google Trends — " + country.label, status: "ok", matches: found.length });
    } catch (error) {
      sources.push({ id: "google-trends-" + country.code.toLowerCase(), name: "Google Trends — " + country.label, status: "error", matches: 0 });
      warnings.push(country.label + " : " + error.message);
    }
  }
  const unique = new Map();
  for (const signal of signals) {
    const key = signal.entityId + ":" + signal.country;
    const previous = unique.get(key);
    if (!previous || Date.parse(signal.publishedAt) > Date.parse(previous.publishedAt)) unique.set(key, signal);
  }
  const result = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    catalog: { provider: "AniList", status: catalog.length ? "ok" : "indisponible", entities: catalog.length },
    sources, items: [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    warnings
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectSearchTrends().then(result => console.log(JSON.stringify({
    entitiesInCatalog: result.catalog.entities, matchedSignals: result.items.length,
    sources: result.sources, warnings: result.warnings
  }, null, 2))).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
