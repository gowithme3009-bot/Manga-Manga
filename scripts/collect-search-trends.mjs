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
  return String(value).normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "")
    .toLocaleLowerCase("fr").replace(/[^\\p{L}\\p{N}]+/gu, " ")
    .replace(/\\bsaison\\b/g, "season").trim();
}

export function matchCatalogEntities(term, catalog) {
  const normalized = normalizeEntityText(term);
  if (!normalized) return [];
  const padded = " " + normalized + " ";
  const matches = (catalog || []).map(entity => {
    const matchedAliases = [...new Set((entity.aliases || [])
      .filter(alias => {
        const candidate = normalizeEntityText(alias);
        if (candidate.length < 5 || ["the man", "the guy", "a man", "a guy"].includes(candidate)) return false;
        if (candidate.includes(" ")) return padded.includes(" " + candidate + " ");
        if (normalized === candidate) return true;
        if (!normalized.startsWith(candidate + " ")) return false;
        const nextWord = normalized.slice(candidate.length + 1).split(" ")[0];
        return !["of", "the", "and", "no", "a", "an", "in", "to", "for"].includes(nextWord);
      }))];
    return matchedAliases.length ? { ...entity, matchedAliases } : null;
  }).filter(Boolean);
  const specific = matches.filter(entity => !matches.some(other =>
    other.id !== entity.id &&
    other.matchedAliases.some(longer => entity.matchedAliases.some(shorter => {
      const shortName = normalizeEntityText(shorter);
      const longName = normalizeEntityText(longer);
      const isLongerTitle = longName.length > shortName.length && longName.startsWith(shortName + " ");
      const isExplicitSeason = /\\b(?:season\\s*(?:[2-9]|ii|iii|iv|v)|(?:2nd|3rd|4th|5th)\\s+season|part\\s*[2-9]|cour\\s*[2-9])\\b/.test(longName);
      // Une suite explicitement numérotée prime sur le titre générique,
      // même si AniList distingue l'adaptation manga et l'adaptation anime.
      return isLongerTitle && (other.type === entity.type || isExplicitSeason);
    }))
  ));
  return specific.sort((a, b) =>
    Math.max(...b.matchedAliases.map(value => normalizeEntityText(value).length)) -
    Math.max(...a.matchedAliases.map(value => normalizeEntityText(value).length))
  );
}

export function matchCatalogEntity(term, catalog) {
  return matchCatalogEntities(term, catalog)[0] || null;
}

export function buildEditorialSignals(newsItems = [], catalog = []) {
  const grouped = new Map();
  const isAggregator = value => /google.?news|google actualit|crunchyroll.*google|official-announcements|otaku-usa/i.test(String(value || ""));
  for (const article of newsItems || []) {
    const matches = matchCatalogEntities(article.title || "", catalog);
    for (const entity of matches) {
      const signal = grouped.get(entity.id) || {
        entityId: entity.id, entityName: entity.name, entityType: entity.type,
        aliasesMatched: [], articleIds: new Set(), sources: new Set(), independentSources: new Set(),
        latestAt: null, articles: []
      };
      for (const alias of entity.matchedAliases) signal.aliasesMatched.push(alias);
      if (!signal.articleIds.has(article.id || article.url || article.title)) {
        signal.articleIds.add(article.id || article.url || article.title);
        const articleSources = article.sources?.length ? article.sources : [article.source].filter(Boolean);
        const articleSourceIds = article.sourceIds?.length ? article.sourceIds : articleSources;
        articleSources.forEach(source => signal.sources.add(source));
        articleSourceIds.filter(source => !isAggregator(source)).forEach(source => signal.independentSources.add(source));
        const date = article.publishedAt || null;
        if (date && (!signal.latestAt || Date.parse(date) > Date.parse(signal.latestAt))) signal.latestAt = date;
        signal.articles.push({
          title: article.title, url: article.url, publishedAt: date,
          sources: articleSources
        });
      }
      grouped.set(entity.id, signal);
    }
  }
  return [...grouped.values()].map(signal => ({
    entityId: signal.entityId, entityName: signal.entityName, entityType: signal.entityType,
    aliasesMatched: [...new Set(signal.aliasesMatched)],
    articleCount: signal.articleIds.size,
    sourceCount: signal.independentSources.size,
    sources: [...signal.sources],
    latestAt: signal.latestAt,
    articles: signal.articles.sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)).slice(0, 5)
  })).sort((a, b) => b.sourceCount - a.sourceCount || b.articleCount - a.articleCount ||
    Date.parse(b.latestAt || 0) - Date.parse(a.latestAt || 0));
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

export async function fetchAniListCatalog(fetchImpl = fetch, pagesPerType = 6) {
  const catalog = [];
  for (const type of ["ANIME", "MANGA"]) {
    for (let page = 1; page <= pagesPerType; page += 1) {
      const query = `query {
        Page(page: ${page}, perPage: 50) {
          media(type: ${type}, sort: TRENDING_DESC, isAdult: false) {
            id
            title { romaji english native }
            synonyms
            popularity
            trending
            format
            genres
            siteUrl
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
      for (const media of payload.data?.Page?.media || []) {
        const aliases = [...new Set([
          media.title?.romaji, media.title?.english, media.title?.native, ...(media.synonyms || [])
        ].filter(value => typeof value === "string" && value.trim()))];
        if (!aliases.length) continue;
        catalog.push({
          id: (type === "ANIME" ? "anime-" : "manga-") + media.id,
          name: media.title?.english || media.title?.romaji || aliases[0],
          nativeTitle: media.title?.native || "",
          romajiTitle: media.title?.romaji || "",
          englishTitle: media.title?.english || "",
          type: type.toLowerCase(),
          aliases,
          popularity: Number(media.popularity) || 0,
          trending: Number(media.trending) || 0,
          format: media.format || "",
          genres: Array.isArray(media.genres) ? media.genres : [],
          url: media.siteUrl || "https://anilist.co/" + type.toLowerCase() + "/" + media.id
        });
      }
    }
  }
  const unique = new Map(catalog.map(entity => [entity.id, entity]));
  return [...unique.values()].sort((a, b) => b.trending - a.trending || b.popularity - a.popularity);
}

export async function collectSearchTrends({
  fetchImpl = fetch, countries = COUNTRIES, now = Date.now(),
  outputPath = path.join(ROOT, "data/trend-signals.json"),
  newsPath = path.join(ROOT, "data/latest-news.json")
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
  let mentions = [];
  try {
    const newsData = JSON.parse(await fs.readFile(newsPath, "utf8"));
    mentions = buildEditorialSignals(newsData.items || [], catalog);
  } catch (error) {
    warnings.push("Mentions éditoriales indisponibles : " + error.message);
  }
  const result = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    catalog: { provider: "AniList", status: catalog.length ? "ok" : "indisponible", entities: catalog.length, refreshedAt: new Date(now).toISOString(), pagesPerType: 6 },
    catalogItems: catalog,
    sources, items: [...unique.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    mentions, warnings
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
