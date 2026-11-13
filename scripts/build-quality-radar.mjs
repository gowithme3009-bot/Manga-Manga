import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 24 * 60 * 60 * 1000;
const TREND_WINDOW = 2 * DAY;
const AGGREGATORS = /google.?news|google actualit|official-announcements|crunchyroll-news|otaku-usa/i;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}
function freshnessScore(hours) {
  if (!Number.isFinite(hours) || hours < 0) return 0;
  if (hours <= 6) return 15;
  if (hours <= 12) return 13;
  if (hours <= 24) return 10;
  if (hours <= 48) return 5;
  return 0;
}
function sourceIdsOf(item) {
  const ids = Array.isArray(item.sourceIds) && item.sourceIds.length
    ? item.sourceIds
    : [item.sourceId || item.source].filter(Boolean);
  return unique(ids.filter(id => !AGGREGATORS.test(id)));
}
function sourceNamesOf(item) {
  return unique(Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : [item.source].filter(Boolean));
}
function articleKey(item) {
  return String(item.id || item.url || item.title || "");
}
function verifiedOriginal(item) {
  return item.articleContentRetrieved === true &&
    item.sourceVerification?.status === "original_page_excerpt_verified";
}
function scoreSiteArticle(item, now) {
  const ids = sourceIdsOf(item);
  const summary = String(item.summary || "").trim();
  const hours = (now - Date.parse(item.publishedAt || "")) / 3600000;
  const source = ids.length ? 20 : 0; // Traçabilité de la source, pas une certification de fiabilité.
  const original = verifiedOriginal(item) ? 20 : 0;
  const precision = verifiedOriginal(item) && summary.length >= 250 ? 20
    : summary.length >= 250 ? 12
    : summary.length >= 120 ? 6 : 0;
  const freshness = freshnessScore(hours);
  const richness = summary.length >= 900 ? 15 : summary.length >= 500 ? 12
    : summary.length >= 250 ? 8 : summary.length >= 120 ? 4 : 0;
  const corroboration = Math.min(10, Math.max(0, ids.length - 1) * 5);
  const score = clamp(source + original + precision + freshness + richness + corroboration);
  const reasons = [];
  if (!ids.length) reasons.push("Aucun média indépendant identifié");
  if (!verifiedOriginal(item)) reasons.push("Page originale non vérifiée");
  if (summary.length < 250) reasons.push("Contenu trop court");
  if (!Number.isFinite(Date.parse(item.publishedAt || ""))) reasons.push("Date absente ou invalide");
  if (hours > 24) reasons.push("Actualité au-delà de la fenêtre de fraîcheur");
  const eligible = score >= 70 && verifiedOriginal(item) && summary.length >= 250 &&
    Number.isFinite(Date.parse(item.publishedAt || "")) && hours >= 0 && hours <= 24 && ids.length > 0;
  return {
    score, decision: eligible ? "eligible_a_evaluer" : score >= 50 ? "surveillance" : "ecarte",
    eligibleForEditorial: eligible, independentSourceCount: ids.length,
    sourceNames: sourceNamesOf(item), verifiedOriginal: verifiedOriginal(item),
    summaryLength: summary.length, freshnessHours: Number.isFinite(hours) ? Math.max(0, Math.round(hours)) : null,
    reasons
  };
}

export function buildQualityRadar(newsItems = [], trendData = {}, generatedAt = new Date().toISOString()) {
  const parsedNow = Date.parse(generatedAt);
  const now = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const siteTrends = (newsItems || []).filter(item => item && item.title && item.url)
    .map(item => {
      const quality = scoreSiteArticle(item, now);
      return {
        id: articleKey(item), title: item.title, url: item.articleUrl || item.url,
        publishedAt: item.publishedAt || null, publisher: item.publisherName || item.source || "Média non identifié",
        sourceNames: quality.sourceNames, summaryLength: quality.summaryLength,
        sourceVerification: item.sourceVerification || null, summary: String(item.summary || "").slice(0, 900),
        ...quality
      };
    }).sort((a, b) => b.score - a.score || (Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)));

  const catalog = new Map((trendData.catalogItems || []).map(entity => [entity.id, entity]));
  const searchSignals = trendData.items || [];
  const entityTrends = (trendData.mentions || []).map(mention => {
    const articles = (mention.articles || []).filter(article => article.url);
    const uniqueArticles = new Map(articles.map(article => [article.url, article]));
    const articleList = [...uniqueArticles.values()];
    const latest = Date.parse(mention.latestAt || "");
    const hours = (now - latest) / 3600000;
    const recentArticles = articleList.filter(article => {
      const date = Date.parse(article.publishedAt || "");
      return Number.isFinite(date) && date <= now && now - date <= TREND_WINDOW;
    });
    const sourceNames = unique(articleList.flatMap(article => article.sources || []));
    const independentNames = unique(recentArticles.flatMap(article => article.sources || [])
      .filter(name => !AGGREGATORS.test(name)));
    const verifiedCount = siteTrends.filter(article =>
      article.verifiedOriginal && recentArticles.some(recent => recent.url === article.url)
    ).length;
    const catalogEntry = catalog.get(mention.entityId);
    const searchMatches = searchSignals.filter(signal => signal.entityId === mention.entityId);
    const mediaScore = Math.min(25, independentNames.length * 10);
    const articleScore = recentArticles.length >= 3 ? 20 : recentArticles.length >= 2 ? 10 : 0;
    const freshScore = freshnessScore(hours);
    const verificationScore = verifiedCount > 0 ? 20 : 0;
    const searchScore = searchMatches.length ? 10 : 0;
    const catalogScore = catalogEntry?.trending > 0 ? Math.min(10, Math.round(catalogEntry.trending / 25)) : 0;
    const score = clamp(mediaScore + articleScore + freshScore + verificationScore + searchScore + catalogScore);
    const confirmed = independentNames.length >= 2 && recentArticles.length >= 2 && verifiedCount >= 1 && score >= 60;
    const strong = confirmed && independentNames.length >= 3 && recentArticles.length >= 3 && score >= 80;
    const reasons = [];
    if (independentNames.length < 2) reasons.push("Moins de deux médias indépendants");
    if (recentArticles.length < 2) reasons.push("Moins de deux articles récents");
    if (!verifiedCount) reasons.push("Aucun extrait de source originale vérifié");
    if (!searchMatches.length) reasons.push("Aucun signal Google Trends associé");
    return {
      entityId: mention.entityId, name: mention.entityName, type: mention.entityType,
      score, decision: strong ? "tendance_forte" : confirmed ? "confirmee" : score >= 50 ? "surveillance" : "signal_faible",
      confirmed, strong, articleCount: articleList.length, recentArticleCount: recentArticles.length,
      independentSourceCount: independentNames.length, verifiedArticleCount: verifiedCount,
      latestAt: mention.latestAt || null, sourceNames: independentNames,
      searchSignalCount: searchMatches.length,
      catalogTrending: Number(catalogEntry?.trending || 0),
      url: catalogEntry?.url || null, reasons,
      recentArticleUrls: recentArticles.map(article => article.url),
      articles: articleList.slice(0, 6)
    };
  }).sort((a, b) => b.score - a.score || b.independentSourceCount - a.independentSourceCount ||
    b.articleCount - a.articleCount || Date.parse(b.latestAt || 0) - Date.parse(a.latestAt || 0));

  const confirmedEntities = entityTrends.filter(entity => entity.confirmed);
  const confirmedArticleUrls = new Set(confirmedEntities.flatMap(entity => entity.recentArticleUrls || []));
  const rankedSiteTrends = siteTrends.map(item => {
    const articleQualityEligible = item.eligibleForEditorial;
    const relatedConfirmed = confirmedEntities.filter(entity => (entity.recentArticleUrls || []).includes(item.url));
    const trendConfirmed = relatedConfirmed.length > 0;
    const trendStrong = relatedConfirmed.some(entity => entity.strong);
    const trendIndependentSourceCount = Math.max(0, ...relatedConfirmed.map(entity => entity.independentSourceCount));
    const trendEntityNames = unique(relatedConfirmed.map(entity => entity.name));
    const eligibleForEditorial = articleQualityEligible && trendConfirmed;
    const reasons = [...item.reasons];
    if (articleQualityEligible && !trendConfirmed) reasons.push("Qualité de l’article suffisante, mais tendance multi-médias non confirmée");
    return {
      ...item, articleQualityEligible, trendConfirmed, trendStrong, trendIndependentSourceCount, trendEntityNames, eligibleForEditorial,
      decision: eligibleForEditorial ? "preselection_tendance_confirmee"
        : articleQualityEligible ? "article_sourcé_tendance_non_confirmee" : item.decision,
      reasons
    };
  });
  return {
    version: 1, generatedAt: new Date(now).toISOString(),
    policy: {
      siteScore: { sourceTraceability: 20, originalPage: 20, factualDetail: 20, freshness: 15, richness: 15, independentCoverage: 10 },
      entityScore: { independentMedia: 25, distinctArticles: 20, freshness: 15, verifiedOriginals: 20, publicSearchSignal: 10, catalogTrendSignal: 10 },
      thresholds: { priority: 80, entityConfirmed: 60, eligible: 70, watch: 50 },
      hardRules: ["Une reprise ou un agrégateur ne compte pas comme média indépendant.", "La couverture des tendances est calculée sur les 48 dernières heures.", "Une tendance confirmée exige au moins deux médias indépendants et deux articles récents distincts, dont au moins une source originale vérifiée.", "Une tendance forte exige au moins trois médias indépendants et trois articles récents distincts.", "Un signal de recherche ou le classement AniList ne suffit jamais à confirmer une actualité.", "Aucun quota ne force la sélection d'un sujet faible."]
    },
    summary: {
      siteArticles: siteTrends.length,
      editorialEligibleSites: rankedSiteTrends.filter(item => item.eligibleForEditorial).length,
      entitiesDetected: entityTrends.length,
      confirmedEntities: confirmedEntities.length,
      strongEntities: confirmedEntities.filter(item => item.strong).length
    },
    siteTrends: rankedSiteTrends, entityTrends, confirmedEntities
  };
}

export async function runQualityRadar({
  newsPath = path.join(ROOT, "data/latest-news.json"),
  trendsPath = path.join(ROOT, "data/trend-signals.json"),
  outputPath = path.join(ROOT, "data/trend-quality.json")
} = {}) {
  const [newsData, trendData] = await Promise.all([
    fs.readFile(newsPath, "utf8").then(JSON.parse),
    fs.readFile(trendsPath, "utf8").then(JSON.parse)
  ]);
  const result = buildQualityRadar(newsData.items || [], trendData, newsData.generatedAt || trendData.generatedAt);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runQualityRadar().then(result => console.log(JSON.stringify(result.summary, null, 2))).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
