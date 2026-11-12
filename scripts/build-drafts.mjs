import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isRelevantGoogleNewsHeadline(title) {
  if (!/\b(manga|mangaka|shonen|shojo|seinen|isekai|webtoon|light novel|anime)\b/i.test(title)) return false;
  // Avoid false positives from the place name “Manga” and unrelated news caught by broad RSS search.
  return !/\b(commissariat|police|produits prohibés)\b/i.test(title);
}

export function buildDailyDrafts(items, generatedAt = new Date().toISOString()) {
  const referenceTime = Date.parse(generatedAt);
  const now = Number.isFinite(referenceTime) ? referenceTime : Date.now();
  const seen = new Set();
  const candidates = [];
  let staleCount = 0;
  let undatedCount = 0;
  let invalidDateCount = 0;
  let irrelevantCount = 0;

  for (const item of items || []) {
    if (!item || typeof item.title !== "string" || typeof item.url !== "string" || !/^https:\/\//i.test(item.url)) continue;

    const language = item.language || "fr";
    if (language !== "fr") continue;

    if (item.sourceId === "google-news-fr" && !isRelevantGoogleNewsHeadline(item.title)) {
      irrelevantCount += 1;
      continue;
    }

    if (!item.publishedAt) {
      undatedCount += 1;
      continue;
    }
    const publishedTime = Date.parse(item.publishedAt);
    if (!Number.isFinite(publishedTime) || publishedTime > now + MAX_FUTURE_SKEW_MS) {
      invalidDateCount += 1;
      continue;
    }
    if (now - publishedTime > MAX_AGE_MS) {
      staleCount += 1;
      continue;
    }

    const rawSummary = String(item.summary || "").replace(/\s+/g, " ").trim().slice(0, 450);
    const titleCore = item.title.trim().split(/\s+-\s+/)[0].toLocaleLowerCase("fr");
    const summary = rawSummary.toLocaleLowerCase("fr").startsWith(titleCore) ? "" : rawSummary;

    const key = item.id || item.url;
    if (seen.has(key)) continue;
    seen.add(key);

    const sourceNames = Array.isArray(item.sources)
      ? item.sources
      : (item.source ? [item.source] : []);
    const freshnessHours = Math.max(0, Math.round((now - publishedTime) / 3600000));
    const sourceUrl = item.articleUrl || item.url;
    const title = item.title.trim();

    const independentSourceCount = Number.isFinite(item.independentSourceCount)
      ? item.independentSourceCount
      : Number.isFinite(item.sourceCount) ? item.sourceCount : 0;
    const coverageSourceCount = Number.isFinite(item.coverageSourceCount)
      ? item.coverageSourceCount : sourceNames.length;
    const trendLevel = independentSourceCount >= 3 && item.trendScore >= 75
      ? "spectaculaire"
      : independentSourceCount >= 2 && freshnessHours <= 48
        ? "hausse"
        : "surveillance";
    const editorialReady = Boolean(summary);
    const text = editorialReady
      ? title + "\n\n" + summary + "\n\nSource : " + sourceUrl +
        "\n\nEt vous, qu’en pensez-vous ?"
      : "PRÉPARATION — TEXTE À COMPLÉTER APRÈS LECTURE\n\n" + title +
        "\n\nInformation confirmée par l’article : [à compléter après vérification]." +
        "\n\nContexte utile pour les lecteurs : [à compléter]." +
        "\n\nQuestion à la communauté : [à adapter]." +
        "\n\nSource : " + sourceUrl;

    candidates.push({
      id: String(key),
      title,
      summary,
      language,
      sourceUrl,
      sourceNames: sourceNames.length ? sourceNames : ["Source non identifiée"],
      publishedAt: new Date(publishedTime).toISOString(),
      freshnessHours,
      trendScore: Number.isFinite(item.trendScore) ? item.trendScore : 0,
      trendLevel,
      independentSourceCount,
      coverageSourceCount,
      freshnessHours,
      editorialReady,
      text,
      hashtags: "#Manga #Anime",
      status: editorialReady ? "texte préparé · source à vérifier" : "à compléter",
      note: editorialReady
        ? "Prépublication construite uniquement à partir du résumé RSS. Vérifier l’article original, les faits, les noms et les dates avant validation."
        : "Aucun résumé exploitable dans le flux. Les champs entre crochets doivent être complétés après lecture de l’article original ; ne pas publier en l’état."
    });
  }

  const trendPriority = { spectaculaire: 3, hausse: 2, surveillance: 1 };
  candidates.sort((a, b) =>
    (trendPriority[b.trendLevel] - trendPriority[a.trendLevel]) ||
    (b.independentSourceCount - a.independentSourceCount) ||
    (b.trendScore - a.trendScore) ||
    (Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  );

  const firstPass = [];
  const usedSources = new Set();
  for (const candidate of candidates) {
    // Diversify only across independently identified media. An aggregator alone
    // must not make every candidate look like a separate direct source.
    const directSources = candidate.independentSourceCount > 0
      ? candidate.sourceNames.filter(name => !/google.?news|google actualit/i.test(name))
      : [];
    if (directSources.length && directSources.some(name => usedSources.has(name))) continue;
    firstPass.push(candidate);
    directSources.forEach(name => usedSources.add(name));
    if (firstPass.length === 4) break;
  }

  const chosenIds = new Set(firstPass.map(candidate => candidate.id));
  const ordered = [...firstPass, ...candidates.filter(candidate => !chosenIds.has(candidate.id))].slice(0, 40);
  const warnings = [];
  if (candidates.length < 4) {
    warnings.push("Moins de quatre actualités récentes, datées et en français sont disponibles. Aucun sujet ne sera inventé.");
  }
  if (!candidates.some(candidate => candidate.trendLevel !== "surveillance")) {
    warnings.push("Aucune tendance multi-sources confirmée dans les propositions : les sujets affichés restent des signaux à surveiller, pas des tendances spectaculaires.");
  }
  if (!candidates.some(candidate => candidate.editorialReady)) {
    warnings.push("Aucun résumé exploitable : les propositions sont des fiches de préparation et ne sont pas prêtes à être publiées.");
  }
  if (staleCount) warnings.push(staleCount + " actualité(s) de plus de 24 heures écartée(s) des propositions du jour.");
  if (undatedCount) warnings.push(undatedCount + " actualité(s) sans date vérifiable écartée(s).");
  if (invalidDateCount) warnings.push(invalidDateCount + " actualité(s) avec date invalide ou future écartée(s).");
  if (irrelevantCount) warnings.push(irrelevantCount + " résultat(s) manifestement hors sujet écarté(s) de la recherche manga/anime.");

  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    freshnessWindowHours: 24,
    limit: 4,
    eligibleCount: candidates.length,
    items: ordered,
    warnings
  };
}

export async function runBuild({ inputPath = path.join(ROOT, "data/latest-news.json"), outputPath = path.join(ROOT, "data/daily-drafts.json") } = {}) {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = buildDailyDrafts(input.items, input.generatedAt || new Date().toISOString());
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBuild().then(result => console.log(JSON.stringify({ eligibleCount: result.eligibleCount, proposals: Math.min(result.eligibleCount, 4), warnings: result.warnings }, null, 2))).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
