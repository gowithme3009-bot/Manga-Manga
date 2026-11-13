const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function extractSeries(question) {
  return String(question || "")
    .replace(/[?!.,;:]/g, " ")
    .replace(/\b(?:quel est|quelle est|donne moi|dis moi|cherche|recherche|trouve|je veux|s il te plait|stp)\b/gi, " ")
    .replace(/\b(?:le|la|les|du|de|des|un|une|pour|sur|dans|en|francais|francaise|francaises|francais|edition|editions|dernier|derniere|prochain|prochaine|sortie|date|disponible|publie|publiee|paru|parue|tome|tomes|volume|volumes|manga|mangas|actualite|actualites|news|annonce|anime|episode|episodes|film|saison|saisons)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}

export function detectEditorialIntent(question) {
  const value = normalize(question);
  if (/\b(tome|tomes|volume|volumes|edition|editions|dernier tome|prochain tome|date de sortie)\b/.test(value)) {
    return { type: "manga_volume", label: "Recherche de tome ou d’édition" };
  }
  if (/\b(anime|actualite|news|annonce|saison|episode|film)\b/.test(value)) {
    return { type: "manga_news", label: "Recherche d’actualité" };
  }
  return { type: "catalog", label: "Recherche dans le catalogue" };
}

export function findEditorialEvidence(question, { catalog = [], articles = [] } = {}) {
  const intent = detectEditorialIntent(question);
  const series = extractSeries(question);
  const needle = normalize(series);
  const catalogMatches = needle ? catalog.filter(item => {
    if (intent.type === "manga_volume" && item.type !== "manga") return false;
    const names = [item.name, item.nativeTitle, item.romajiTitle, item.englishTitle, ...(item.aliases || [])];
    return names.some(name => {
      const candidate = normalize(name);
      return candidate === needle || (needle.length >= 3 && candidate.includes(needle));
    });
  }).slice(0, 5) : [];
  const articleMatches = needle ? articles.filter(item => {
    const text = normalize([item.title, item.summary, ...(item.sources || [])].join(" "));
    return text.includes(needle);
  }).slice(0, 5) : [];
  return { intent, series, catalogMatches, articleMatches };
}

export function buildEditorialAnswer(question, evidence) {
  const { intent, series, catalogMatches, articleMatches } = evidence;
  const title = series || String(question || "").trim();
  if (intent.type === "manga_volume") {
    const match = catalogMatches[0];
    const recognised = match ? "J’ai reconnu le manga « " + match.name + " » dans le catalogue." : "Je n’ai pas trouvé de correspondance certaine dans le catalogue local.";
    return {
      intent,
      heading: "Recherche du dernier tome",
      message: recognised + " Le catalogue AniList sert à identifier les œuvres : il ne confirme ni le dernier tome publié en France, ni son numéro, ni sa date de sortie. Je ne vais donc pas inventer ces informations.",
      query: title,
      searchLabel: "Rechercher les tomes auprès de l’éditeur",
      sourceLabel: "Consulter les résultats web sur l’édition française",
      articleMatches
    };
  }
  if (articleMatches.length) {
    return {
      intent,
      heading: "Éléments trouvés dans le Radar",
      message: articleMatches.length + " article(s) du Radar correspondent à « " + title + " ». Ouvre les sources originales pour vérifier les informations.",
      articleMatches
    };
  }
  if (catalogMatches.length) {
    return {
      intent,
      heading: "Œuvre reconnue dans le catalogue",
      message: "J’ai trouvé « " + catalogMatches[0].name + " ». Le catalogue fournit une fiche d’identification et un signal AniList, pas une confirmation d’actualité récente.",
      articleMatches
    };
  }
  return {
    intent,
    heading: "Recherche à préciser",
    message: "Je n’ai pas trouvé de source correspondante dans les données actuellement chargées. Essaie le titre exact ou consulte les recherches externes proposées.",
    query: title,
    searchLabel: "Rechercher sur le Web",
    articleMatches
  };
}
