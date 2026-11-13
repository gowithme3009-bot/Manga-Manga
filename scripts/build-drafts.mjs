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


export function scoreEditorialFit(item) {
  const title = String(item?.title || "");
  const summary = String(item?.summary || "");
  const sourceLanguage = item?.language || "fr";
  let score = 0;
  if (sourceLanguage === "fr") score += 8;
  if (item?.articleContentRetrieved === true) score += 8;
  if (summary.length >= 250) score += 8;
  else if (summary.length < 120) score -= 15;
  if (/\b(review|critique|roundtable|table ronde)\b/i.test(title)) score -= 18;
  if (/\b(interview|entretien)\b/i.test(title)) score -= 6;
  if (/article sponsorisé|contenu sponsorisé|partenariat rémunéré/i.test(summary)) score -= 25;
  if (/(?:a donné|s'est produit|était en concert|s’est produit|était présent|a eu lieu).{0,100}\b(?:le|en)\s+\d{1,2}\b/i.test(summary)) score -= 12;
  return score;
}

export function buildDailyDrafts(items, generatedAt = new Date().toISOString(), qualityById = null) {
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

    const sourceLanguage = item.language || "fr";
    const canTranslateFromOriginal = sourceLanguage === "en" && item.articleContentRetrieved === true;
    if (sourceLanguage !== "fr" && !canTranslateFromOriginal) continue;
    const language = "fr";

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

    const summaryLimit = item.articleContentRetrieved ? 1600 : 450;
    const rawSummary = String(item.summary || "").replace(/\s+/g, " ").trim().slice(0, summaryLimit);
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
    const qualityRecord = qualityById instanceof Map ? qualityById.get(String(key)) : null;
    const trendLevel = qualityRecord?.trendConfirmed
      ? (qualityRecord.trendStrong ? "spectaculaire" : "hausse")
      : independentSourceCount >= 3 && item.trendScore >= 75
        ? "spectaculaire"
        : independentSourceCount >= 2 && freshnessHours <= 48
          ? "hausse"
          : "surveillance";
    const editorialReady = Boolean(summary) && sourceLanguage === "fr";
    const text = editorialReady
      ? title + "\n\n" + summary + "\n\nSource : " + sourceUrl +
        "\n\nEt vous, qu’en pensez-vous ?"
      : canTranslateFromOriginal && summary
        ? "PRÉPARATION — SOURCE ORIGINALE EN ANGLAIS, TRADUCTION FRANÇAISE À GÉNÉRER PAR L’ASSISTANT IA\n\n" + title +
          "\n\nExtrait original : " + summary + "\n\nSource : " + sourceUrl
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
      sourceLanguage,
      sourceUrl,
      articleUrl: item.articleUrl || item.url,
      articleContentRetrieved: Boolean(item.articleContentRetrieved),
      sourceVerification: item.sourceVerification || { status: item.articleContentRetrieved ? "original_page_excerpt_verified" : "rss_only_unverified", label: item.articleContentRetrieved ? "Extrait du média d’origine récupéré" : "Source originale non vérifiée" },
      publisherName: item.publisherName || null,
      publisherUrl: item.publisherUrl || null,
      summaryOrigin: item.summaryOrigin || "rss",
      sourceNames: sourceNames.length ? sourceNames : ["Source non identifiée"],
      publishedAt: new Date(publishedTime).toISOString(),
      freshnessHours,
      trendScore: Number.isFinite(item.trendScore) ? item.trendScore : 0,
      editorialFitScore: scoreEditorialFit({ ...item, summary }),
      qualityScore: qualityById instanceof Map ? (qualityById.get(String(key))?.score ?? null) : null,
      qualityDecision: qualityById instanceof Map ? (qualityById.get(String(key))?.decision ?? "non_evalue") : "non_evalue",
      trendLevel,
      independentSourceCount,
      coverageSourceCount,
      freshnessHours,
      editorialReady,
      text,
      hashtags: "#Manga #Anime",
      status: editorialReady ? "texte préparé · source à vérifier" : "à compléter",
      note: editorialReady
        ? "Prépublication construite à partir du résumé RSS. Vérifier l’article original, les faits, les noms et les dates avant validation."
        : canTranslateFromOriginal && summary
          ? "Extrait original récupéré sur le média anglophone. Une rédaction/traduction française par l’assistant IA est nécessaire ; vérifier chaque fait avant validation."
          : "Aucun résumé exploitable dans le flux. Les champs entre crochets doivent être complétés après lecture de l’article original ; ne pas publier en l’état."
    });
  }

  const trendPriority = { spectaculaire: 3, hausse: 2, surveillance: 1 };
  // Ordre éditorial : confirmation multi-sources, provenance vérifiée,
  // résumé exploitable, puis fraîcheur et disponibilité d'un extrait.
  // Un score élevé ne compense jamais une source faible ou un résumé absent.
  const hasVerifiedOriginal = candidate =>
    candidate.sourceVerification?.status === "original_page_excerpt_verified";
  candidates.sort((a, b) =>
    (trendPriority[b.trendLevel] - trendPriority[a.trendLevel]) ||
    (b.independentSourceCount - a.independentSourceCount) ||
    (b.editorialFitScore - a.editorialFitScore) ||
    (Number(hasVerifiedOriginal(b)) - Number(hasVerifiedOriginal(a))) ||
    (Number(Boolean(b.summary)) - Number(Boolean(a.summary))) ||
    (b.trendScore - a.trendScore) ||
    (Number(b.articleContentRetrieved) - Number(a.articleContentRetrieved)) ||
    (Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  );

  // Les quatre sujets destinés à l'IA suivent le classement éditorial réel.
  // Ne pas éliminer un meilleur sujet simplement parce que le même média
  // a publié une autre actualité : la diversité des sources ne doit pas
  // faire remonter artificiellement des sujets moins pertinents.
  const qualityFiltered = qualityById instanceof Map
    ? candidates.filter(candidate => qualityById.get(candidate.id)?.eligibleForEditorial === true)
    : candidates;
  const firstPass = qualityFiltered.slice(0, 4);
  const chosenIds = new Set(firstPass.map(candidate => candidate.id));
  const ordered = [...firstPass, ...qualityFiltered.filter(candidate => !chosenIds.has(candidate.id))].slice(0, 40);
  const warnings = [];
  if (qualityById instanceof Map && qualityFiltered.length < candidates.length) {
    warnings.push((candidates.length - qualityFiltered.length) + " sujet(s) écarté(s) par le contrôle qualité strict : source originale, contenu détaillé et fraîcheur obligatoires.");
  }
  if (qualityFiltered.length < 4) {
    warnings.push("Seulement " + qualityFiltered.length + " sujet(s) satisfont les critères qualité stricts. Aucun sujet faible ne sera ajouté pour remplir quatre places.");
  }
  const hasConfirmedTrend = qualityById instanceof Map
    ? qualityFiltered.length > 0
    : candidates.some(candidate => candidate.trendLevel !== "surveillance");
  if (!hasConfirmedTrend) {
    warnings.push("Aucune tendance multi-sources confirmée dans les propositions : les sujets affichés restent des signaux à surveiller, pas des tendances spectaculaires.");
  }
  if (!candidates.some(candidate => candidate.editorialReady || (candidate.articleContentRetrieved && candidate.summary))) {
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
    eligibleCount: qualityFiltered.length,
    items: ordered,
    warnings
  };
}

export async function runBuild({ inputPath = path.join(ROOT, "data/latest-news.json"), outputPath = path.join(ROOT, "data/daily-drafts.json") } = {}) {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const quality = JSON.parse(await fs.readFile(path.join(ROOT, "data/trend-quality.json"), "utf8"));
  const qualityById = new Map((quality.siteTrends || []).map(item => [item.id, item]));
  const result = buildDailyDrafts(input.items, input.generatedAt || new Date().toISOString(), qualityById);
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBuild().then(result => console.log(JSON.stringify({ eligibleCount: result.eligibleCount, proposals: Math.min(result.eligibleCount, 4), warnings: result.warnings }, null, 2))).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
