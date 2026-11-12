"use strict";

import { readStoredArray, writeStoredArray } from "./storage.js";

const STORAGE_KEY = "mangaMangaStudio.drafts.v1";
const DISMISSED_KEY = "mangaMangaStudio.dismissed.v1";
const TREND_ALERTS_KEY = "mangaMangaStudio.trendAlerts.v1";
const state = { items: [], sources: [], searchSignals: [], editorialSignals: [], catalog: [], drafts: [], candidates: [], dismissed: [], editingDraftId: null, trendAlerts: [], radarError: null, generatedImageDataUrl: null, pendingDraftImageDataUrl: null, workflowDraftId: null };
const PREPUBLICATION_CHECKS = [
  { id: "trend", label: "Le sujet est récent et mérite une publication." },
  { id: "source", label: "La source originale est ouverte et le média identifié." },
  { id: "facts", label: "Les noms, dates, chiffres et informations incertaines sont contrôlés." },
  { id: "copy", label: "Le texte et les hashtags sont relus et fidèles à la source." },
  { id: "visual", label: "Le visuel est adapté et ses droits d’utilisation sont vérifiés." },
  { id: "preview", label: "L’aperçu Facebook est relu sur téléphone." }
];
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

const storageIssues = new Set();

function readArray(key) {
  const result = readStoredArray(localStorage, key, key === STORAGE_KEY ? "drafts" : "strings");
  if (result.issue) storageIssues.add(key);
  return result.value;
}

function exportStorageRecovery() {
  const recovery = {};
  for (const key of storageIssues) {
    try {
      recovery[key] = localStorage.getItem(key);
    } catch (error) {
      recovery[key] = null;
    }
  }
  if (!Object.keys(recovery).length) {
    toast("Aucune donnée locale à récupérer.");
    return;
  }
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    warning: "Copie brute des données locales illisibles. Ne pas remplacer les données de l’application sans vérification.",
    data: recovery
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "manga-manga-recuperation-locale.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeStorageSet(key, value) {
  return writeStoredArray(localStorage, key, value);
}

function saveDrafts(nextDrafts) {
  if (storageIssues.has(STORAGE_KEY)) {
    toast("Sauvegarde bloquée : les anciennes données sont illisibles. Exporte d’abord la récupération locale.");
    return false;
  }
  if (!safeStorageSet(STORAGE_KEY, nextDrafts)) {
    toast("Impossible d’enregistrer sur cet appareil. Vos brouillons précédents sont conservés ; exportez-les avant de poursuivre.");
    return false;
  }
  state.drafts = nextDrafts;
  updateCounts();
  return true;
}
function saveDismissed(nextDismissed) {
  if (storageIssues.has(DISMISSED_KEY)) {
    toast("Action bloquée : les données locales des propositions sont illisibles. Exporte d’abord la récupération locale.");
    return false;
  }
  if (!safeStorageSet(DISMISSED_KEY, nextDismissed)) {
    toast("Impossible de mémoriser cette proposition écartée. Elle pourra réapparaître au prochain chargement.");
    return false;
  }
  state.dismissed = nextDismissed;
  return true;
}
function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2800);
}

let workflowSignalTimer;
function signalStep(stage, title, detail) {
  const panel = $("workflow-signal");
  if (!panel) return;
  $("workflow-signal-title").textContent = title;
  $("workflow-signal-detail").textContent = detail;
  panel.dataset.stage = String(stage);
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("show"));
  clearTimeout(workflowSignalTimer);
  workflowSignalTimer = setTimeout(() => {
    panel.classList.remove("show");
    setTimeout(() => { panel.hidden = true; }, 240);
  }, 3600);
}
function showView(name) {
  document.querySelectorAll(".view").forEach(element => {
    element.classList.toggle("hidden", element.id !== "view-" + name);
  });
  document.querySelectorAll(".nav").forEach(element => {
    element.classList.toggle("active", element.dataset.view === name);
  });
  location.hash = name;
}
function buildTrendAlerts() {
  const alerts = [];
  state.items.forEach(item => {
    const level = item.trendLevel || ((item.trendScore ?? 0) >= 75 ? "spectaculaire" : (item.trendScore ?? 0) >= 50 ? "hausse" : "surveillance");
    const sources = item.independentSourceCount ?? item.sourceCount ?? 0;
    if (level === "spectaculaire" && sources >= 2) alerts.push({
      id: "rss:" + (item.id || item.url || item.title), title: item.title,
      detail: sources + " source(s) directe(s) · score " + (item.trendScore ?? "—") + "/100",
      url: item.url || "", kind: "Actualité multi-sources"
    });
  });
  state.editorialSignals.forEach(signal => {
    if (signal.sourceCount >= 3 && signal.articleCount >= 3) alerts.push({
      id: "title:" + String(signal.entityName || "").toLocaleLowerCase("fr"),
      title: signal.entityName,
      detail: signal.articleCount + " article(s) · " + signal.sourceCount + " source(s) directe(s)",
      url: signal.articles?.[0]?.url || "", kind: "Titre manga/anime confirmé"
    });
  });
  const unique = new Map();
  alerts.forEach(alert => { if (!unique.has(alert.id)) unique.set(alert.id, alert); });
  return [...unique.values()].slice(0, 12);
}
function renderTrendAlerts() {
  const host = $("trend-alerts-list");
  if (!host) return;
  if (!state.trendAlerts.length) {
    host.innerHTML = '<p class="muted">Aucune tendance époustouflante confirmée pour le dernier cycle. Les tendances en hausse restent visibles dans le Radar.</p>';
    return;
  }
  host.innerHTML = state.trendAlerts.map(alert =>
    '<article class="trend-alert-item"><span class="trend-alert-light" aria-hidden="true"></span><div class="trend-alert-copy"><strong>' +
    escapeHtml(alert.title) + '</strong><small>' + escapeHtml(alert.kind + " · " + alert.detail) +
    '</small></div>' + (alert.url ? '<a class="secondary" href="' + escapeHtml(alert.url) + '" target="_blank" rel="noopener noreferrer">Voir la source ↗</a>' : '<button class="secondary" type="button" data-go="radar">Voir le Radar ↗</button>') +
    '</article>'
  ).join("");
}
function notifyNewTrendAlerts(alerts) {
  let previous;
  try { const raw = localStorage.getItem(TREND_ALERTS_KEY); previous = raw ? JSON.parse(raw) : null; } catch { previous = null; }
  const ids = alerts.map(alert => alert.id);
  const firstCheck = !Array.isArray(previous);
  const fresh = firstCheck ? [] : alerts.filter(alert => !previous.includes(alert.id));
  try { localStorage.setItem(TREND_ALERTS_KEY, JSON.stringify(ids)); } catch { /* stockage facultatif */ }
  if (!firstCheck && fresh.length && "Notification" in window && Notification.permission === "granted") {
    fresh.slice(0, 3).forEach(alert => {
      try {
        const notice = new Notification("Tendance époustouflante détectée", {
          body: alert.title + " — " + alert.detail, tag: alert.id,
          icon: "./logo-manga-anime-actualites%20(1).png"
        });
        notice.onclick = () => { window.focus(); showView("radar"); notice.close(); };
      } catch { /* alerte conservée dans le tableau de bord */ }
    });
  }
}
function updateNotificationStatus() {
  const status = $("notification-status"), button = $("enable-trend-notifications");
  if (!status || !button) return;
  if (!("Notification" in window)) { status.textContent = "Notifications non prises en charge."; button.disabled = true; }
  else if (Notification.permission === "granted") { status.textContent = "Notifications autorisées sur cet appareil."; button.textContent = "Notifications activées"; button.disabled = true; }
  else if (Notification.permission === "denied") status.textContent = "Autorisation refusée : vérifie les réglages du navigateur.";
  else status.textContent = "Autorisation nécessaire pour afficher les alertes.";
}
function getDraftChecks(draft) {
  const stored = Array.isArray(draft?.prepublicationChecks) ? draft.prepublicationChecks : [];
  // Migration douce des anciens brouillons à 8 cases vers la nouvelle liste à 6.
  if (stored.length >= 8) return [
    Boolean(stored[0]), Boolean(stored[1]), Boolean(stored[2] && stored[3]),
    Boolean(stored[4] && stored[5]), Boolean(stored[6]), Boolean(stored[7])
  ];
  return PREPUBLICATION_CHECKS.map((_, index) => Boolean(stored[index]));
}
function updateGuidedWorkflow() {
  const setStep = (number, level, message) => {
    const card = document.querySelector('.guided-step[data-step="' + number + '"]');
    const light = $("guided-light-" + number), status = $("guided-status-" + number);
    if (!card || !light || !status) return;
    card.dataset.state = level;
    light.dataset.state = level;
    status.textContent = message;
  };
  const draftCount = state.drafts.length;
  const illustrated = state.drafts.filter(draft => Boolean(draft.imageDataUrl)).length;
  const validated = state.drafts.filter(draft => draft.status === "validé pour prépublication").length;
  const completeChecks = state.drafts.filter(draft => getDraftChecks(draft).every(Boolean)).length;
  setStep(1, state.radarError ? "blocked" : state.items.length ? "ready" : "waiting", state.radarError ? "Radar indisponible : " + state.radarError : state.items.length ? state.items.length + " actualité(s) disponibles dans le radar" : "En attente de la prochaine collecte");
  setStep(2, draftCount ? "ready" : state.candidates.length ? "active" : "waiting", draftCount ? draftCount + " brouillon(s) enregistré(s)" : state.candidates.length ? state.candidates.length + " proposition(s) à examiner" : "Choisis une actualité pour commencer");
  setStep(3, illustrated ? "ready" : draftCount ? "active" : "waiting", illustrated ? illustrated + " visuel(s) associé(s)" : draftCount ? "Ajoute un visuel à ton brouillon" : "Le visuel viendra après le texte");
  setStep(4, validated ? "ready" : completeChecks || draftCount ? "active" : "waiting", validated ? validated + " prépublication(s) validée(s)" : draftCount ? completeChecks + " brouillon(s) avec contrôles terminés" : "Enregistre un brouillon pour commencer les contrôles");
  const summary = $("guided-summary");
  if (summary) summary.textContent = validated
    ? validated + " contenu(s) prêt(s) pour publication manuelle."
    : draftCount ? draftCount + " brouillon(s) en cours · " + illustrated + " avec visuel · " + validated + " validé(s)."
    : "Commence par le Radar : le studio te guidera ensuite.";
}
function updateCounts() {
  $("draft-count").textContent = state.drafts.length;
  $("home-draft-count").textContent = state.drafts.length;
  $("article-count").textContent = state.items.length;
  $("source-count").textContent = state.sources.filter(source => source.status === "ok").length;
  updateGuidedWorkflow();
}
function dateLabel(value) {
  if (!value) return "Date non fournie";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date non valide";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}
function trendSignal(level, label) {
  const known = ["spectaculaire", "hausse", "surveillance"].includes(level) ? level : "surveillance";
  const names = { spectaculaire: "Tendance forte", hausse: "Tendance en hausse", surveillance: "Tendance à surveiller", recherche: "Signal de recherche publique" };
  const key = level === "recherche" ? "search" : known;
  return '<span class="trend-indicator trend-indicator-' + key + '" role="img" aria-label="' +
    escapeHtml(names[level] || names[known]) + '" title="' + escapeHtml(names[level] || names[known]) +
    '"><span class="trend-light"></span><span class="trend-indicator-label">' +
    escapeHtml(label || names[level] || names[known]) + '</span></span>';
}
function renderNews() {
  const query = $("search").value.trim().toLocaleLowerCase("fr");
  const filtered = state.items.filter(item =>
    (item.title + " " + item.summary + " " + (item.sources || []).join(" "))
      .toLocaleLowerCase("fr").includes(query)
  );
  $("radar-meta").textContent = filtered.length + " sujet(s)";
  if (!filtered.length) {
    $("news-list").innerHTML = '<p class="muted">Aucun article ne correspond. Vérifie les sources activées ou la recherche.</p>';
    return;
  }
  $("news-list").innerHTML = filtered.map(item => {
    const sourceNames = item.sources || (item.source ? [item.source] : []);
    const level = item.trendLevel || ((item.trendScore ?? 0) >= 75 ? "spectaculaire" : (item.trendScore ?? 0) >= 50 ? "hausse" : "surveillance");
    const levelLabel = trendSignal(level, level === "spectaculaire" ? "FORTE" : level === "hausse" ? "EN HAUSSE" : "À SURVEILLER");
    const cardClass = level === "spectaculaire" ? "news-card is-spectacular" : level === "hausse" ? "news-card is-rising" : "news-card";
    return '<article class="' + cardClass + '" data-trend-level="' + escapeHtml(level) + '">' +
      '<div class="meta">' + levelLabel + " " + escapeHtml(sourceNames.join(", ") || "Source") + " · " +
      escapeHtml(dateLabel(item.publishedAt)) + " · " + (item.independentSourceCount ?? item.sourceCount ?? 0) +
      " source(s) directe(s) · " + (item.coverageSourceCount ?? sourceNames.length) +
      " couverture(s) · score " + (item.trendScore ?? "—") + "/100</div>" +
      "<h3>" + escapeHtml(item.title) + "</h3>" +
      '<p class="summary">' + escapeHtml(item.summary || "La source ne fournit pas de résumé exploitable. Consulte l’article original avant de rédiger.") + "</p>" +
      '<div class="card-actions"><a class="secondary" href="' + escapeHtml(item.url) +
      '" target="_blank" rel="noopener noreferrer">Lire la source ↗</a>' +
      '<button class="primary" data-edit="' + escapeHtml(item.id) + '">Préparer un brouillon</button></div></article>';
  }).join("");
}
function renderSearchSignals() {
  const host = $("search-signals");
  if (!host) return;
  if (!state.searchSignals.length) {
    host.innerHTML = '<p class="muted">Aucun titre manga/anime du catalogue n’a été repéré dans les tendances de recherche publiques lors du dernier cycle. Cela ne signifie pas qu’il n’existe aucune tendance.</p>';
    return;
  }
  host.innerHTML = state.searchSignals.map(signal =>
    '<article class="signal-card is-search-signal"><div class="meta">' + trendSignal("recherche", "RECHERCHE REPÉRÉE") + ' · ' +
    escapeHtml(signal.countryLabel) + ' · ' + escapeHtml(dateLabel(signal.publishedAt)) + '</div>' +
    '<h3>' + escapeHtml(signal.entityName) + '</h3>' +
    '<p class="summary">Recherche repérée : ' + escapeHtml(signal.title) + ' · ' +
    escapeHtml(signal.entityType) + (signal.approximateTraffic ? ' · volume estimé ' + escapeHtml(signal.approximateTraffic) : '') + '</p>' +
    '<small class="muted">Signal Google Trends agrégé, rapproché du catalogue AniList. Ce n’est pas un compteur de clics ni une mesure mondiale.</small>' +
    '<div class="card-actions"><a class="secondary" href="' + escapeHtml(signal.url) + '" target="_blank" rel="noopener noreferrer">Voir la tendance ↗</a></div></article>'
  ).join("");
}
function renderEditorialSignals() {
  const host = $("editorial-signals");
  if (!host) return;
  if (!state.editorialSignals.length) {
    host.innerHTML = '<p class="muted">Aucun titre du catalogue n’a été reconnu dans les articles RSS du dernier cycle. Le catalogue AniList reste consultable séparément.</p>';
    return;
  }
  host.innerHTML = state.editorialSignals.slice(0, 30).map(signal => {
    const level = signal.sourceCount >= 3 && signal.articleCount >= 3 ? "spectaculaire" : signal.sourceCount >= 2 ? "hausse" : "surveillance";
    return '<article class="signal-card signal-card-trend signal-card-' + level + '"><div class="meta">' +
    trendSignal(level, level === "spectaculaire" ? "FORTE COUVERTURE" : level === "hausse" ? "MULTI-SOURCES" : "À SURVEILLER") +
    ' · MENTIONS DANS LES ACTUALITÉS · ' + signal.articleCount + ' article(s) · ' + signal.sourceCount + ' source(s) directe(s)</div>' +
    '<h3>' + escapeHtml(signal.entityName) + '</h3>' +
    '<p class="summary">' + escapeHtml(signal.entityType) + ' · ' +
    escapeHtml((signal.aliasesMatched || []).slice(0, 3).join(' · ')) + '</p>' +
    '<div class="card-actions">' + (signal.articles || []).slice(0, 3).map(article =>
      '<a class="secondary" href="' + escapeHtml(article.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(article.title) + ' ↗</a>'
    ).join('') + '</div></article>';
  }).join("");
}
function renderCatalog() {
  const host = $("catalog-list");
  if (!host) return;
  const query = ($("catalog-search")?.value || "").trim().toLocaleLowerCase("fr");
  const matches = state.catalog.filter(entity =>
    [entity.name, entity.nativeTitle, entity.romajiTitle, entity.englishTitle, ...(entity.aliases || [])]
      .join(" ").toLocaleLowerCase("fr").includes(query)
  );
  const visible = matches.slice(0, 80);
  const meta = $("catalog-meta");
  if (meta) meta.textContent = matches.length + " titre(s) trouvé(s) · " + state.catalog.length + " au catalogue";
  if (!visible.length) {
    host.innerHTML = '<p class="muted">Aucun titre trouvé. Essaie un nom japonais, anglais, romaji ou un alias.</p>';
    return;
  }
  host.innerHTML = visible.map(entity =>
    '<article class="catalog-card"><div class="catalog-card-top"><span class="catalog-kind">' +
    (entity.type === "anime" ? "ANIME" : "MANGA") + '</span><span class="catalog-popularity">Tendance AniList : ' +
    Number(entity.trending || 0).toLocaleString("fr-FR") + '</span></div>' +
    '<h3><a href="' + escapeHtml(entity.url) + '" target="_blank" rel="noopener noreferrer">' +
    escapeHtml(entity.name) + ' ↗</a></h3>' +
    (entity.nativeTitle && entity.nativeTitle !== entity.name ? '<p class="catalog-native">' + escapeHtml(entity.nativeTitle) + '</p>' : '') +
    '<p class="catalog-aliases">' + escapeHtml((entity.aliases || []).filter(name => name !== entity.name).slice(0, 3).join(" · ")) + '</p>' +
    '<div class="catalog-card-bottom"><span>' + escapeHtml(entity.format || "Titre") + '</span>' +
    '<span>' + escapeHtml((entity.genres || []).slice(0, 2).join(" · ")) + '</span></div>' +
    '<div class="card-actions"><a class="secondary" href="https://news.google.com/search?q=' +
    encodeURIComponent(entity.name + " manga anime") + '" target="_blank" rel="noopener noreferrer">Actualités récentes ↗</a></div></article>'
  ).join("");
}
function renderSources() {
  if (!state.sources.length) {
    $("sources-list").innerHTML = '<p class="muted">Aucune source n’est configurée.</p>';
    return;
  }
  $("sources-list").innerHTML = state.sources.map(source =>
    '<article class="source-card"><strong>' + escapeHtml(source.name) + "</strong>" +
    '<p class="muted">' + escapeHtml(source.status) + " · " + (source.items || 0) + " article(s)</p>" +
    '<a href="' + escapeHtml(source.homepage) + '" target="_blank" rel="noopener noreferrer">Site de référence ↗</a></article>'
  ).join("");
}
function buildMasterImagePrompt(draft) {
  const clean = value => String(value || "").replace(/https?:\\/\\/\\S+/g, "").replace(/[#*_]/g, " ").replace(/\\s+/g, " ").trim();
  return [
    "Create an original editorial anime illustration for a French manga and anime news Facebook post.",
    "Main subject inspired by this news headline: " + clean(draft.title).slice(0, 180) + ".",
    "Visual context: " + clean(draft.body).slice(0, 420) + ".",
    "Use original fictional characters only; do not imitate a named artist or reproduce copyrighted character designs.",
    "Premium Japanese animation-inspired visual storytelling, expressive composition, cinematic lighting, polished details, clear focal point, square 1:1 composition.",
    "No text, no letters, no logo, no watermark, no UI, no collage."
  ].join(" ");
}
function openVisualStep() {
  const draft = state.drafts.find(item => item.id === state.workflowDraftId) || state.drafts.find(item => item.id === state.editingDraftId);
  if (!draft) { toast("Enregistre d’abord ta publication à l’étape 2."); showView("atelier"); return; }
  state.workflowDraftId = draft.id;
  $("image-prompt").value = draft.imagePromptMaster || buildMasterImagePrompt(draft);
  $("master-prompt-status").textContent = "Prompt maître préparé depuis : " + draft.title;
  showView("studio-images");
  signalStep(3, "Étape 3/4 · Visuel prêt", "Le prompt maître est automatiquement lié au brouillon enregistré.");
}
function attachImageToWorkflowDraft(dataUrl) {
  const draftId = state.workflowDraftId || state.editingDraftId;
  const index = state.drafts.findIndex(item => item.id === draftId);
  if (index < 0) { state.pendingDraftImageDataUrl = dataUrl; return false; }
  const nextDrafts = [...state.drafts];
  nextDrafts[index] = { ...nextDrafts[index], imageDataUrl: dataUrl, imagePromptMaster: $("image-prompt").value,
    prepublicationChecks: getDraftChecks(nextDrafts[index]).map((value, position) => position === 4 || position === 5 ? false : value),
    status: "à relire", validatedAt: null };
  if (!saveDrafts(nextDrafts)) return false;
  renderDrafts();
  $("attach-image-status").textContent = "Image sauvegardée avec le bon brouillon.";
  return true;
}
function renderEditorImage() {
  const image = $("editor-attached-image");
  const source = state.pendingDraftImageDataUrl ||
    (state.editingDraftId ? state.drafts.find(draft => draft.id === state.editingDraftId)?.imageDataUrl : null);
  if (!image) return;
  if (source) { image.src = source; image.classList.remove("hidden"); }
  else { image.removeAttribute("src"); image.classList.add("hidden"); }
}
function renderMediaLibrary() {
  const host = $("generated-media-list");
  if (!host) return;
  const illustrated = state.drafts.filter(draft => draft.imageDataUrl);
  host.innerHTML = illustrated.length ? illustrated.map(draft =>
    '<article class="media-card"><img src="' + escapeHtml(draft.imageDataUrl) + '" alt="Visuel associé au brouillon ' + escapeHtml(draft.title) + '" loading="lazy">' +
    '<strong>' + escapeHtml(draft.title) + '</strong><small class="muted">Brouillon · ' + escapeHtml(dateLabel(draft.createdAt)) + '</small>' +
    '<a href="' + escapeHtml(draft.imageDataUrl) + '" download="manga-manga-visuel-' + escapeHtml(draft.id) + '.jpg">Télécharger</a></article>'
  ).join("") : '<p class="muted">Les visuels associés à tes brouillons apparaîtront ici.</p>';
}
function renderPrepublicationChecklist(draft) {
  const checks = getDraftChecks(draft);
  const completed = checks.filter(Boolean).length;
  const ready = completed === PREPUBLICATION_CHECKS.length;
  const approved = draft.status === "validé pour prépublication" && ready;
  const items = PREPUBLICATION_CHECKS.map((check, index) => {
    const imageRequired = check.id === "visual";
    const disabled = imageRequired && !draft.imageDataUrl;
    return '<label class="prepub-check' + (disabled ? ' is-blocked' : '') + '">' +
      '<input type="checkbox" data-prepub-check data-draft-id="' + escapeHtml(draft.id) +
      '" data-check-index="' + index + '"' + (checks[index] ? ' checked' : '') +
      (disabled ? ' disabled' : '') + '>' +
      '<span>' + escapeHtml(check.label) +
      (disabled ? '<small>Ajoute d’abord un visuel au brouillon.</small>' : '') +
      '</span></label>';
  }).join("");
  return '<section class="prepub-panel" aria-label="Contrôle avant prépublication">' +
    '<div class="prepub-heading"><strong>Vérification avant prépublication</strong>' +
    '<span class="prepub-progress-count">' + completed + '/' + PREPUBLICATION_CHECKS.length + ' contrôles</span></div>' +
    '<div class="prepub-progress" role="progressbar" aria-label="Progression des contrôles" aria-valuemin="0" aria-valuemax="' +
    PREPUBLICATION_CHECKS.length + '" aria-valuenow="' + completed + '"><span style="width:' +
    (completed / PREPUBLICATION_CHECKS.length * 100) + '%"></span></div>' +
    '<div class="prepub-checklist">' + items + '</div>' +
    (approved
      ? '<p class="prepub-approved">✓ Validé pour prépublication le ' + escapeHtml(dateLabel(draft.validatedAt)) +
        '. Copie le contenu et publie-le manuellement dans Meta Business Suite.</p>'
      : '<p class="prepub-hint">' + (ready
        ? 'Tous les contrôles sont cochés. Tu peux confirmer la validation humaine.'
        : (PREPUBLICATION_CHECKS.length - completed) + ' contrôle(s) restant(s). La validation est bloquée tant qu’un contrôle manque.') + '</p>') +
    '<button class="primary prepub-validate" type="button" data-validate-prepub="' + escapeHtml(draft.id) +
    '"' + (!ready || approved ? ' disabled' : '') + '>' +
    (approved ? 'Prépublication validée' : 'Valider pour prépublication') + '</button>' +
    '<small class="prepub-safety">Cette validation ne publie rien et n’envoie aucune donnée à Facebook.</small></section>';
}
function renderDrafts() {
  const savedSources = new Set(state.drafts.map(draft => draft.sourceId));
  const proposals = state.candidates
    .filter(candidate => !state.dismissed.includes(candidate.id) && !savedSources.has(candidate.id))
    .slice(0, 4);
  const proposedHtml = proposals.map(candidate => {
    const level = candidate.trendLevel || "surveillance";
    const label = level === "spectaculaire" ? "TENDANCE MULTI-SOURCES" :
      level === "hausse" ? "PLUSIEURS MÉDIAS" : "SIGNAL À SURVEILLER";
    return '<article class="draft-card"><div class="meta">PROPOSITION · ' +
      trendSignal(level, label) + " · Score indicatif " + candidate.trendScore + "/100 · " +
      Number(candidate.independentSourceCount || 0) + " média(s) direct(s) · " +
      escapeHtml((candidate.sourceNames || []).join(", ")) +
      (candidate.aiGenerated ? " · ✧ Assistant IA (" + escapeHtml(candidate.aiModel || "Groq") + ")" : "") + "</div>" +
      "<h3>" + escapeHtml(candidate.aiTitle || candidate.title) + "</h3>" +
      '<p class="summary">' + escapeHtml(candidate.text) + "</p>" +
      '<p class="tags">' + escapeHtml(candidate.hashtags) + "</p>" +
      '<small class="muted">Provenance : ' + escapeHtml(candidate.sourceVerification?.label || "Source originale non vérifiée") +
      (candidate.sourceVerification?.publisherHost ? " · " + escapeHtml(candidate.sourceVerification.publisherHost) : "") +
      (candidate.publisherName ? " · Éditeur RSS : " + escapeHtml(candidate.publisherName) : "") + "</small>" +
      (candidate.aiAudit ? '<small class="muted">Contrôle automatique des chiffres : ' +
        (candidate.aiAudit.unsupportedNumbers?.length
          ? "⚠️ à vérifier (" + escapeHtml(candidate.aiAudit.unsupportedNumbers.join(", ")) + ")"
          : "aucune alerte numérique détectée") +
        " — ce contrôle ne vérifie pas les autres affirmations.</small>" : "") +
      '<small class="muted">' + escapeHtml(candidate.note || "Vérification humaine obligatoire.") + "</small>" +
      '<div class="card-actions"><a class="secondary" href="' + escapeHtml(candidate.sourceUrl) +
      '" target="_blank" rel="noopener noreferrer">Vérifier la source ↗</a>' +
      (candidate.publisherUrl ? '<a class="secondary" href="' + escapeHtml(candidate.publisherUrl) +
        '" target="_blank" rel="noopener noreferrer">Site du média ↗</a>' : "") +
      '<button class="primary" data-save-candidate="' + escapeHtml(candidate.id) + '">Ajouter à mes brouillons</button>' +
      '<button class="danger" data-dismiss-candidate="' + escapeHtml(candidate.id) + '">Écarter / remplacer</button></div>' +
      '<small class="muted">Aucune publication automatique. La validation humaine reste obligatoire.</small></article>';
  }).join("");
  const savedHtml = state.drafts.map(draft =>
    '<article class="draft-card"><div class="meta">Créé le ' + escapeHtml(dateLabel(draft.createdAt)) +
    " · " + escapeHtml(draft.status) + "</div><h3>" + escapeHtml(draft.title) + "</h3>" +
    '<section class="facebook-final-preview"><div class="fb-head">Manga, Animé et Actualités · Aperçu Facebook</div><h4>' + escapeHtml(draft.title) + "</h4>" +
    (draft.imageDataUrl ? '<img class="draft-image" src="' + escapeHtml(draft.imageDataUrl) + '" alt="Visuel correspondant à cette publication" loading="lazy">' : '<p class="visual-missing">Visuel à créer à l’étape 3.</p>') +
    '<p class="summary">' + escapeHtml(draft.body) + "</p>" + '<p class="tags">' + escapeHtml(draft.hashtags) + "</p></section>" +
    renderPrepublicationChecklist(draft).replace("Valider pour prépublication", "Sauvegarder") +
    '<div class="card-actions"><button class="primary" data-edit-draft="' + escapeHtml(draft.id) +
    '">Modifier</button><button class="secondary" data-copy="' + escapeHtml(draft.id) +
    '">Copier</button><a class="secondary" href="' + escapeHtml(draft.sourceUrl) +
    '" target="_blank" rel="noopener noreferrer">Source ↗</a>' +
    '<button class="danger" data-delete="' + escapeHtml(draft.id) + '">Supprimer</button></div>' +
    '<small class="muted">Aperçu et copie uniquement — non publié.</small></article>'
  ).join("");
  $("drafts-status").textContent = proposals.length + " proposition(s) disponibles · " +
    state.drafts.length + " brouillon(s) personnel(s) enregistrés sur cet appareil.";
  $("draft-list").innerHTML = (proposedHtml + savedHtml) ||
    '<p class="muted">Aucune proposition disponible. Le radar attend des actualités françaises avec source vérifiable.</p>';
  renderMediaLibrary();
  renderEditorImage();
  updateCounts();
}
function getActiveDraftChanges() {
  const activeDraft = state.editingDraftId
    ? state.drafts.find(draft => draft.id === state.editingDraftId)
    : null;
  if (!activeDraft) return null;
  return {
    activeDraft,
    changed: $("draft-title").value !== activeDraft.title ||
      $("draft-body").value !== activeDraft.body ||
      $("draft-tags").value !== (activeDraft.hashtags || "") ||
      state.pendingDraftImageDataUrl !== null
  };
}

function confirmDiscardActiveDraft() {
  const current = getActiveDraftChanges();
  if (!current || !current.changed) return true;
  if (window.confirm(
    "Tu as des modifications non enregistrées. Changer de contenu les abandonnera. Continuer ?"
  )) return true;
  $("story-select").value = current.activeDraft.sourceId;
  return false;
}

window.addEventListener("beforeunload", event => {
  const current = getActiveDraftChanges();
  if (!current || !current.changed) return;
  event.preventDefault();
  event.returnValue = "";
});

function updateSelectedSourceLink() {
  const item = state.items.find(entry => entry.id === $("story-select").value);
  const wrap = $("selected-source-wrap"), link = $("selected-source-link");
  if (!wrap || !link) return;
  if (item?.url) { link.href = item.url; wrap.hidden = false; }
  else { wrap.hidden = true; link.removeAttribute("href"); }
}
function fillEditor(item) {
  state.editingDraftId = null;
  $("save-draft").textContent = "Enregistrer le brouillon";
  $("story-select").value = item.id;
  updateSelectedSourceLink();
  $("draft-title").value = item.title;
  $("draft-body").value = (item.summary ? item.summary + "\n\n" : "") +
    "Lire l’article complet à la source : " + item.url;
  renderEditorImage();
  showView("atelier");
  signalStep(2, "Étape 2/4 · Rédaction", "Actualité sélectionnée. Vérifiez le titre et le texte avant l’enregistrement.");
}
function makeDraft() {
  const selectedId = $("story-select").value;
  const item = state.items.find(entry => entry.id === selectedId);
  const originalDraft = state.editingDraftId
    ? state.drafts.find(draft => draft.id === state.editingDraftId)
    : null;
  if (!item && !originalDraft) throw new Error("Choisis d’abord une actualité du radar.");
  const title = $("draft-title").value.trim();
  const body = $("draft-body").value.trim();
  const hashtags = $("draft-tags").value.trim();
  if (!title || !body) throw new Error("Le titre et le texte sont nécessaires.");
  return {
    id: crypto.randomUUID(),
    sourceId: item?.id || originalDraft.sourceId,
    title, body, hashtags,
    sourceUrl: item?.url || originalDraft.sourceUrl,
    sourceName: item
      ? (item.source || (item.sources || []).join(", "))
      : (originalDraft.sourceName || "Source d’origine conservée"),
    createdAt: new Date().toISOString(),
    status: "à relire",
    prepublicationChecks: PREPUBLICATION_CHECKS.map(() => false),
    validatedAt: null,
    imageDataUrl: state.pendingDraftImageDataUrl || originalDraft?.imageDataUrl || null,
    imagePromptMaster: originalDraft?.imagePromptMaster || null
  };
}
async function loadRadar() {
  try {
    const [newsResponse, sourceResponse, trendsResponse] = await Promise.all([
      fetch("./data/latest-news.json", { cache: "no-store" }),
      fetch("./data/sources.json", { cache: "no-store" }),
      fetch("./data/trend-signals.json", { cache: "no-store" }).catch(() => null)
    ]);
    if (!newsResponse.ok) throw new Error("Fichier du radar indisponible (HTTP " + newsResponse.status + ")");
    const data = await newsResponse.json();
    state.radarError = null;
    const config = sourceResponse.ok ? await sourceResponse.json() : { rssSources: [] };
    const collected = new Map((data.sources || []).map(source => [source.id, source]));
    state.items = Array.isArray(data.items) ? data.items : [];
    if (trendsResponse?.ok) {
      const trendData = await trendsResponse.json();
      state.searchSignals = Array.isArray(trendData.items) ? trendData.items : [];
      state.editorialSignals = Array.isArray(trendData.mentions) ? trendData.mentions : [];
      state.catalog = Array.isArray(trendData.catalogItems) ? trendData.catalogItems : [];
    } else { state.searchSignals = []; state.editorialSignals = []; state.catalog = []; }
    state.sources = (config.rssSources || []).map(source => ({
      ...source,
      ...(collected.get(source.id) || {}),
      status: collected.get(source.id)?.status || (source.enabled ? "en attente" : "désactivée")
    }));
    $("home-status").textContent = state.items.length
      ? state.items.length + " actualité(s) collectée(s). Consulte les liens originaux avant validation."
      : (data.warnings || []).join(" ") || "Aucun article collecté.";
    $("story-select").innerHTML = '<option value="">Choisir une actualité…</option>' +
      state.items.map(item => '<option value="' + escapeHtml(item.id) + '">' +
        escapeHtml(item.title) + "</option>").join("");
    renderNews();
    renderSearchSignals();
    renderEditorialSignals();
    renderCatalog();
    renderSources();
    state.trendAlerts = buildTrendAlerts();
    renderTrendAlerts();
    notifyNewTrendAlerts(state.trendAlerts);
    updateNotificationStatus();
    updateCounts();
  } catch (error) {
    state.radarError = error.message;
    updateGuidedWorkflow();
    $("home-status").textContent = error.message;
    $("news-list").innerHTML = '<p class="muted">' + escapeHtml(error.message) + "</p>";
    toast(error.message);
  }
}
async function loadDailyCandidates() {
  try {
    const response = await fetch("./data/daily-drafts.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    state.candidates = Array.isArray(data.items) ? data.items : [];
    renderDrafts();
    updateGuidedWorkflow();
  } catch {
    state.candidates = [];
  }
}

document.addEventListener("click", async event => {
  const check = event.target.closest("[data-prepub-check]");
  if (check) {
    const draft = state.drafts.find(item => item.id === check.dataset.draftId);
    const index = Number(check.dataset.checkIndex);
    if (!draft || !Number.isInteger(index) || index < 0 || index >= PREPUBLICATION_CHECKS.length) return;
    if (PREPUBLICATION_CHECKS[index].id === "visual" && !draft.imageDataUrl) {
      check.checked = false;
      toast("Ajoute un visuel avant de valider ce contrôle.");
      return;
    }
    const checks = getDraftChecks(draft).map((value, position) =>
      position === index ? check.checked : value
    );
    const nextDrafts = state.drafts.map(item => item.id === draft.id
      ? { ...item, prepublicationChecks: checks, status: "à relire", validatedAt: null }
      : item);
    if (saveDrafts(nextDrafts)) renderDrafts();
    return;
  }
  const validatePrepub = event.target.closest("[data-validate-prepub]");
  if (validatePrepub) {
    const draft = state.drafts.find(item => item.id === validatePrepub.dataset.validatePrepub);
    const checks = getDraftChecks(draft);
    if (!draft || !checks.every(Boolean) || !draft.imageDataUrl) {
      toast("Validation impossible : termine tous les contrôles et ajoute un visuel.");
      return;
    }
    const validatedAt = new Date().toISOString();
    const nextDrafts = state.drafts.map(item => item.id === draft.id
      ? { ...item, status: "validé pour prépublication", validatedAt }
      : item);
    if (saveDrafts(nextDrafts)) {
      renderDrafts();
      toast("Brouillon validé. La publication reste manuelle.");
      signalStep(4, "Prépublication validée", "Tous les contrôles sont terminés. Publie uniquement après ta dernière vérification dans Meta Business Suite.");
    }
    return;
  }
  const nav = event.target.closest("[data-view]");
  if (nav) {
    event.preventDefault();
    showView(nav.dataset.view);
    return;
  }
  const go = event.target.closest("[data-go]");
  if (go) {
    showView(go.dataset.go);
    return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    const item = state.items.find(entry => entry.id === edit.dataset.edit);
    if (item && confirmDiscardActiveDraft()) fillEditor(item);
    return;
  }
  const editDraft = event.target.closest("[data-edit-draft]");
  if (editDraft) {
    const draft = state.drafts.find(item => item.id === editDraft.dataset.editDraft);
    if (!draft) {
      toast("Ce brouillon n’existe plus. Actualise la liste avant de réessayer.");
      return;
    }
    if (!confirmDiscardActiveDraft()) return;
    const source = state.items.find(item => item.id === draft.sourceId);
    if (!source) {
      const optionExists = Array.from($("story-select").options).some(option => option.value === draft.sourceId);
      if (!optionExists) {
        const option = document.createElement("option");
        option.value = draft.sourceId;
        option.textContent = "Source conservée — " + draft.title;
        $("story-select").appendChild(option);
      }
    }
    state.editingDraftId = draft.id;
    state.workflowDraftId = draft.id;
    $("story-select").value = draft.sourceId;
    updateSelectedSourceLink();
    $("draft-title").value = draft.title;
    $("draft-body").value = draft.body;
    $("draft-tags").value = draft.hashtags || "";
    state.pendingDraftImageDataUrl = null;
    renderEditorImage();
    $("save-draft").textContent = "Enregistrer les modifications";
    showView("atelier");
    signalStep(2, "Étape 2/4 · Relecture", "Votre brouillon est ouvert dans l’atelier. Modifiez-le puis enregistrez vos changements.");
    return;
  }
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    const deletedId = remove.dataset.delete;
    const nextDrafts = state.drafts.filter(draft => draft.id !== deletedId);
    if (saveDrafts(nextDrafts)) {
      if (state.editingDraftId === deletedId) {
        state.editingDraftId = null;
        $("save-draft").textContent = "Enregistrer le brouillon";
        $("story-select").value = "";
        $("draft-title").value = "";
        $("draft-body").value = "";
        $("draft-tags").value = "";
        $("editor-preview").classList.add("hidden");
      }
      renderDrafts();
      toast("Brouillon supprimé.");
    }
    return;
  }
  const save = event.target.closest("[data-save-candidate]");
  if (save) {
    const candidate = state.candidates.find(item => item.id === save.dataset.saveCandidate);
    if (candidate && !state.drafts.some(draft => draft.sourceId === candidate.id)) {
      const nextDrafts = [{
        id: crypto.randomUUID(), sourceId: candidate.id, title: candidate.title,
        body: candidate.text, hashtags: candidate.hashtags, sourceUrl: candidate.sourceUrl,
        sourceName: (candidate.sourceNames || []).join(", "),
        createdAt: new Date().toISOString(), status: candidate.status || "à relire"
      }, ...state.drafts];
      if (saveDrafts(nextDrafts)) {
        renderDrafts();
        signalStep(3, "Étape 3/4 · Brouillon enregistré", "Votre proposition est sauvegardée sur cet appareil. Passez à l’aperçu ou à la relecture.");
        toast("Proposition ajoutée aux brouillons.");
      }
    }
    return;
  }
  const dismiss = event.target.closest("[data-dismiss-candidate]");
  if (dismiss) {
    if (!state.dismissed.includes(dismiss.dataset.dismissCandidate)) {
      const nextDismissed = [...state.dismissed, dismiss.dataset.dismissCandidate];
      if (!saveDismissed(nextDismissed)) return;
    }
    renderDrafts();
    signalStep(1, "Proposition remplacée", "La proposition écartée est masquée ; la suivante prend sa place.");
    toast("Proposition écartée ; la suivante prend sa place.");
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    const draft = state.drafts.find(item => item.id === copy.dataset.copy);
    if (!draft) return;
    try {
      await navigator.clipboard.writeText([draft.title, draft.body, draft.hashtags, draft.sourceUrl].filter(Boolean).join("\n\n"));
      signalStep(4, "Texte copié", "Vous pouvez coller le brouillon dans votre outil de publication. Rien n’a été publié.");
      toast("Texte copié.");
    } catch {
      toast("Copie indisponible sur cet appareil.");
    }
  }
});

function activateRadarTab(tab) {
  const showTitles = tab === "titles";
  $("radar-sites-panel").hidden = showTitles;
  $("radar-sites-panel").classList.toggle("hidden", showTitles);
  $("radar-titles-panel").hidden = !showTitles;
  $("radar-titles-panel").classList.toggle("hidden", !showTitles);
  $("tab-sites").classList.toggle("active", !showTitles);
  $("tab-titles").classList.toggle("active", showTitles);
  $("tab-sites").setAttribute("aria-selected", String(!showTitles));
  $("tab-titles").setAttribute("aria-selected", String(showTitles));
}
$("tab-sites").addEventListener("click", () => activateRadarTab("sites"));
$("tab-titles").addEventListener("click", () => activateRadarTab("titles"));
$("search").addEventListener("input", renderNews);
$("catalog-search").addEventListener("input", renderCatalog);
$("refresh").addEventListener("click", loadRadar);
$("story-select").addEventListener("change", () => {
  updateSelectedSourceLink();
  const item = state.items.find(entry => entry.id === $("story-select").value);
  if (!item || !confirmDiscardActiveDraft()) return;
  fillEditor(item);
});
$("save-draft").addEventListener("click", () => {
  try {
    const draft = makeDraft();
    let nextDrafts;
    if (state.editingDraftId) {
      const index = state.drafts.findIndex(item => item.id === state.editingDraftId);
      if (index < 0) throw new Error("Ce brouillon n’existe plus.");
      draft.id = state.editingDraftId;
      draft.createdAt = state.drafts[index].createdAt;
      nextDrafts = [...state.drafts];
      nextDrafts[index] = draft;
      if (!saveDrafts(nextDrafts)) return;
      state.pendingDraftImageDataUrl = null;
      state.editingDraftId = null;
      renderEditorImage();
      $("save-draft").textContent = "Enregistrer le brouillon";
      signalStep(3, "Étape 3/4 · Modifications enregistrées", "Votre brouillon mis à jour est conservé sur cet appareil.");
      toast("Modifications enregistrées sur cet appareil.");
    } else {
      if (state.drafts.some(item => item.sourceId === draft.sourceId)) {
        toast("Cette actualité possède déjà un brouillon.");
        return;
      }
      nextDrafts = [draft, ...state.drafts];
      if (!saveDrafts(nextDrafts)) return;
      state.pendingDraftImageDataUrl = null;
      renderEditorImage();
      signalStep(3, "Étape 3/4 · Brouillon enregistré", "Votre texte est sauvegardé. Vous pouvez maintenant vérifier son aperçu.");
      toast("Brouillon enregistré sur cet appareil.");
    }
    state.workflowDraftId = draft.id;
    const storedDraft = state.drafts.find(item => item.id === draft.id);
    if (storedDraft && !storedDraft.imagePromptMaster) {
      const updated = state.drafts.map(item => item.id === draft.id ? { ...item, imagePromptMaster: buildMasterImagePrompt(item) } : item);
      if (saveDrafts(updated)) renderDrafts();
    }
    renderDrafts();
  } catch (error) {
    toast(error.message);
  }
});
$("next-to-visual").addEventListener("click", openVisualStep);
$("go-prepublication").addEventListener("click", () => {
  if (!state.workflowDraftId || !state.drafts.some(item => item.id === state.workflowDraftId)) { toast("Enregistre d’abord la publication."); showView("atelier"); return; }
  showView("brouillons");
  signalStep(4, "Étape 4/4 · Prépublication", "Retrouve le texte et le visuel associés dans l’aperçu Facebook.");
});
$("preview-draft").addEventListener("click", () => {
  $("preview-title").textContent = $("draft-title").value.trim();
  $("preview-body").textContent = $("draft-body").value.trim();
  $("preview-tags").textContent = $("draft-tags").value;
  const previewImage = $("preview-image");
  const activeImage = state.pendingDraftImageDataUrl || (state.editingDraftId ? state.drafts.find(draft => draft.id === state.editingDraftId)?.imageDataUrl : null);
  if (activeImage) { previewImage.src = activeImage; previewImage.classList.remove("hidden"); }
  else { previewImage.removeAttribute("src"); previewImage.classList.add("hidden"); }
  $("editor-preview").classList.remove("hidden");
  signalStep(4, "Étape 4/4 · Aperçu prêt", "Relisez le rendu Facebook. La publication reste entièrement manuelle.");
});
$("copy-ai-prompt").addEventListener("click", async () => {
  const selectedId = $("story-select").value;
  const item = state.items.find(entry => entry.id === selectedId);
  const savedDraft = state.editingDraftId
    ? state.drafts.find(draft => draft.id === state.editingDraftId)
    : null;
  if (!item && !savedDraft) {
    toast("Choisis d’abord une actualité ou ouvre un brouillon enregistré.");
    return;
  }
  const sourceTitle = item?.title || savedDraft.title;
  const sourceSummary = item?.summary || "Résumé du flux indisponible ; utiliser uniquement le texte déjà rédigé et vérifier l’article original.";
  const sourceUrl = item?.url || savedDraft.sourceUrl;
  const prompt = [
    "RÔLE : Tu es rédacteur francophone spécialisé manga et anime.",
    "OBJECTIF : Améliorer un brouillon Facebook naturel, clair et fidèle à la source.",
    "RÈGLES : Réponds uniquement en français. N’invente aucun fait, date, citation, chiffre ou déclaration. Distingue les faits confirmés des hypothèses. Si les informations sont insuffisantes, indique-le. Ne prétends pas avoir lu l’article complet si seul l’extrait est fourni. Conserve le lien source.",
    "FORMAT : Titre ; contexte ; résumé fidèle des seuls éléments fournis ; question à la communauté ; hashtags modérés.",
    "TITRE SOURCE : " + sourceTitle,
    "EXTRAIT FOURNI PAR LE FLUX : " + sourceSummary,
    "BROUILLON ACTUEL : " + $("draft-title").value.trim() + "\n" + $("draft-body").value.trim(),
    "SOURCE : " + (sourceUrl || "Lien source non disponible"),
    "CONSIGNE : Prépare une proposition à relire. Si les informations ne suffisent pas, signale clairement ce qui doit être vérifié."
  ].join(String.fromCharCode(10, 10));
  try {
    await navigator.clipboard.writeText(prompt);
    signalStep(2, "Brief IA copié", "Collez-le dans ChatGPT ; Gemini reste une solution de repli.");
    toast("Brief copié. Colle-le dans ChatGPT ; Gemini peut servir de repli.");
  } catch {
    toast("Copie automatique indisponible sur cet appareil.");
  }
});
$("export-drafts").addEventListener("click", () => {
  if (!state.drafts.length) {
    toast("Aucun brouillon à exporter pour l’instant.");
    return;
  }
  const blob = new Blob([JSON.stringify(state.drafts, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "manga-manga-brouillons.json";
  anchor.click();
  signalStep(4, "Export demandé", "Le navigateur prépare le fichier. Vérifiez vos téléchargements pour le retrouver.");
  // Laisser au navigateur mobile le temps de démarrer le téléchargement.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});


async function optimizeImageForStorage(blob) {
  if (typeof createImageBitmap !== "function") {
    throw new Error("Ce navigateur ne permet pas de préparer l’image pour la sauvegarde. Tu peux toujours la télécharger.");
  }
  const bitmap = await createImageBitmap(blob);
  const maxSide = 960;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("Préparation de l’image impossible sur cet appareil."); }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

const generateImageButton = $("generate-image");
if (generateImageButton) {
  let generatedImageUrl = null;
  generateImageButton.addEventListener("click", async () => {
    const prompt = $("image-prompt").value.trim();
    const status = $("image-generator-status");
    const result = $("generated-image-result");
    if (!prompt) {
      status.textContent = "Ajoute une description avant de lancer la génération.";
      return;
    }
    generateImageButton.disabled = true;
    generateImageButton.textContent = "Génération en cours…";
    status.textContent = "Connexion au moteur Stable Diffusion XL. La génération peut prendre un moment.";
    result.classList.add("hidden");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          prompt,
          size: "1024x1024"
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 350);
        if (response.status === 401 || response.status === 403) {
          throw new Error("Le service exige une authentification. Nous n’ajouterons aucune clé ni moyen de paiement sans ton accord.");
        }
        if (response.status === 429) {
          throw new Error("Limite anonyme atteinte. Attends une minute avant un nouvel essai.");
        }
        throw new Error("Le service a répondu " + response.status + (detail ? " : " + detail : ""));
      }
      const payload = await response.json();
      const encoded = payload?.data?.[0]?.b64_json;
      if (!encoded || typeof encoded !== "string") {
        throw new Error("Réponse reçue, mais aucune image encodée n’a été fournie par le service.");
      }
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const blob = new Blob([bytes], { type: "image/png" });
      state.generatedImageDataUrl = await optimizeImageForStorage(blob);
      attachImageToWorkflowDraft(state.generatedImageDataUrl);
      $("attach-image-status").textContent = "Image générée et associée automatiquement au brouillon.";
      if (generatedImageUrl) URL.revokeObjectURL(generatedImageUrl);
      generatedImageUrl = URL.createObjectURL(blob);
      $("generated-image").src = generatedImageUrl;
      $("download-generated-image").href = generatedImageUrl;
      result.classList.remove("hidden");
      status.textContent = "Image reçue. Vérifie-la puis télécharge-la ; rien n’est publié ni envoyé sur Facebook.";
      signalStep(3, "Visuel généré et sauvegardé", "L’image est automatiquement associée au brouillon sélectionné.");
    } catch (error) {
      const message = error.name === "AbortError"
        ? "Le service n’a pas répondu en 2 minutes. Réessaie plus tard."
        : error instanceof TypeError
          ? "Connexion refusée par le navigateur (possible blocage CORS ou réseau). L’accès depuis le site n’est pas encore confirmé."
          : error.message;
      status.textContent = message;
    } finally {
      clearTimeout(timeout);
      generateImageButton.disabled = false;
      generateImageButton.textContent = "Tester et générer une image";
    }
  });
  $("attach-generated-image").addEventListener("click", () => {
    if (!state.generatedImageDataUrl) { toast("Génère d’abord une image."); return; }
    if (state.editingDraftId) {
      const index = state.drafts.findIndex(draft => draft.id === state.editingDraftId);
      if (index < 0) { toast("Ouvre à nouveau le brouillon avant d’y joindre le visuel."); return; }
      const nextDrafts = [...state.drafts];
      nextDrafts[index] = {
        ...nextDrafts[index],
        imageDataUrl: state.generatedImageDataUrl,
        prepublicationChecks: getDraftChecks(nextDrafts[index]).map((value, position) =>
          position === 4 || position === 5 ? false : value
        ),
        status: "à relire",
        validatedAt: null
      };
      if (!saveDrafts(nextDrafts)) return;
      renderDrafts();
      $("attach-image-status").textContent = "Visuel enregistré dans le brouillon ouvert.";
      toast("Visuel ajouté et enregistré dans le brouillon.");
      signalStep(3, "Visuel associé", "Le visuel est conservé avec le brouillon sur cet appareil.");
      return;
    }
    state.pendingDraftImageDataUrl = state.generatedImageDataUrl;
    showView("atelier");
    renderEditorImage();
    $("attach-image-status").textContent = "Visuel prêt. Choisis une actualité dans l’Atelier, rédige le texte puis enregistre le brouillon.";
    toast("Visuel prêt. Choisis une actualité dans l’Atelier.");
    signalStep(3, "Visuel prêt", "Enregistre le brouillon dans l’Atelier pour conserver l’image.");
  });
}

state.drafts = readArray(STORAGE_KEY);
state.dismissed = readArray(DISMISSED_KEY);
if (storageIssues.size) {
  const recoveryButton = $("export-recovery");
  if (recoveryButton) recoveryButton.hidden = false;
  toast("Attention : des données locales sont illisibles. Exporte la récupération avant toute autre opération.");
}
renderDrafts();
loadRadar();
loadDailyCandidates();
// Vérifier périodiquement les nouvelles tendances lorsque le tableau de bord reste ouvert.
setInterval(loadRadar, 10 * 60 * 1000);


$("enable-trend-notifications")?.addEventListener("click", async () => {
  if (!("Notification" in window)) { toast("Les notifications ne sont pas prises en charge."); return; }
  try {
    const permission = await Notification.requestPermission();
    updateNotificationStatus();
    if (permission === "granted") {
      toast("Notifications autorisées. Les nouvelles tendances seront signalées lorsque le site est ouvert.");
      new Notification("Manga-Manga — alertes activées", { body: "Tu seras averti des nouvelles tendances fortes pendant l’utilisation du site." });
    } else toast("Autorisation de notification non accordée.");
  } catch { toast("Impossible d’activer les notifications sur cet appareil."); }
});
updateNotificationStatus();
$("export-recovery")?.addEventListener("click", exportStorageRecovery);
