"use strict";

import { readStoredArray, writeStoredArray } from "./storage.js";

const STORAGE_KEY = "mangaMangaStudio.drafts.v1";
const DISMISSED_KEY = "mangaMangaStudio.dismissed.v1";
const state = { items: [], sources: [], searchSignals: [], catalog: [], drafts: [], candidates: [], dismissed: [], editingDraftId: null };
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
function updateCounts() {
  $("draft-count").textContent = state.drafts.length;
  $("home-draft-count").textContent = state.drafts.length;
  $("article-count").textContent = state.items.length;
  $("source-count").textContent = state.sources.filter(source => source.status === "ok").length;
}
function dateLabel(value) {
  if (!value) return "Date non fournie";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date non valide";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
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
    const levelLabel = level === "spectaculaire" ? '<span class="trend-badge trend-badge-hot">✦ À NE PAS MANQUER</span>' : level === "hausse" ? '<span class="trend-badge trend-badge-up">↗ EN HAUSSE</span>' : '<span class="trend-badge trend-badge-watch">À SURVEILLER</span>';
    const cardClass = level === "spectaculaire" ? "news-card is-spectacular" : level === "hausse" ? "news-card is-rising" : "news-card";
    return '<article class="' + cardClass + '" data-trend-level="' + escapeHtml(level) + '">' +
      '<div class="meta">' + levelLabel + " " + escapeHtml(sourceNames.join(", ") || "Source") + " · " +
      escapeHtml(dateLabel(item.publishedAt)) + " · " + (item.sourceCount || 1) +
      " source(s) indépendantes · score " + (item.trendScore ?? "—") + "/100</div>" +
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
    '<article class="signal-card"><div class="meta"><span class="signal-type">RECHERCHE PUBLIQUE</span> · ' +
    escapeHtml(signal.countryLabel) + ' · ' + escapeHtml(dateLabel(signal.publishedAt)) + '</div>' +
    '<h3>' + escapeHtml(signal.entityName) + '</h3>' +
    '<p class="summary">Recherche repérée : ' + escapeHtml(signal.title) + ' · ' +
    escapeHtml(signal.entityType) + (signal.approximateTraffic ? ' · volume estimé ' + escapeHtml(signal.approximateTraffic) : '') + '</p>' +
    '<small class="muted">Signal Google Trends agrégé, rapproché du catalogue AniList. Ce n’est pas un compteur de clics ni une mesure mondiale.</small>' +
    '<div class="card-actions"><a class="secondary" href="' + escapeHtml(signal.url) + '" target="_blank" rel="noopener noreferrer">Voir la tendance ↗</a></div></article>'
  ).join("");
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
    '<span>' + escapeHtml((entity.genres || []).slice(0, 2).join(" · ")) + '</span></div></article>'
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
function renderDrafts() {
  const savedSources = new Set(state.drafts.map(draft => draft.sourceId));
  const proposals = state.candidates
    .filter(candidate => !state.dismissed.includes(candidate.id) && !savedSources.has(candidate.id))
    .slice(0, 4);
  const proposedHtml = proposals.map(candidate =>
    '<article class="draft-card"><div class="meta">PROPOSITION · ' +
    escapeHtml(candidate.status) + " · Score " + candidate.trendScore + " · " +
    escapeHtml((candidate.sourceNames || []).join(", ")) + "</div>" +
    "<h3>" + escapeHtml(candidate.title) + "</h3>" +
    '<p class="summary">' + escapeHtml(candidate.text) + "</p>" +
    '<p class="tags">' + escapeHtml(candidate.hashtags) + "</p>" +
    '<div class="card-actions"><a class="secondary" href="' + escapeHtml(candidate.sourceUrl) +
    '" target="_blank" rel="noopener noreferrer">Vérifier la source ↗</a>' +
    '<button class="primary" data-save-candidate="' + escapeHtml(candidate.id) + '">Ajouter à mes brouillons</button>' +
    '<button class="danger" data-dismiss-candidate="' + escapeHtml(candidate.id) + '">Écarter / remplacer</button></div>' +
    '<small class="muted">Vérification humaine obligatoire avant toute publication.</small></article>'
  ).join("");
  const savedHtml = state.drafts.map(draft =>
    '<article class="draft-card"><div class="meta">Créé le ' + escapeHtml(dateLabel(draft.createdAt)) +
    " · " + escapeHtml(draft.status) + "</div><h3>" + escapeHtml(draft.title) + "</h3>" +
    '<p class="summary">' + escapeHtml(draft.body) + "</p>" +
    '<p class="tags">' + escapeHtml(draft.hashtags) + "</p>" +
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
      $("draft-tags").value !== (activeDraft.hashtags || "")
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

function fillEditor(item) {
  state.editingDraftId = null;
  $("save-draft").textContent = "Enregistrer le brouillon";
  $("story-select").value = item.id;
  $("draft-title").value = item.title;
  $("draft-body").value = (item.summary ? item.summary + "\n\n" : "") +
    "Lire l’article complet à la source : " + item.url;
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
    status: originalDraft?.status || "à relire"
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
    const config = sourceResponse.ok ? await sourceResponse.json() : { rssSources: [] };
    const collected = new Map((data.sources || []).map(source => [source.id, source]));
    state.items = Array.isArray(data.items) ? data.items : [];
    if (trendsResponse?.ok) {
      const trendData = await trendsResponse.json();
      state.searchSignals = Array.isArray(trendData.items) ? trendData.items : [];
      state.catalog = Array.isArray(trendData.catalogItems) ? trendData.catalogItems : [];
    } else { state.searchSignals = []; state.catalog = []; }
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
    renderSources();
    updateCounts();
  } catch (error) {
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
  } catch {
    state.candidates = [];
  }
}

document.addEventListener("click", async event => {
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
    $("story-select").value = draft.sourceId;
    $("draft-title").value = draft.title;
    $("draft-body").value = draft.body;
    $("draft-tags").value = draft.hashtags || "";
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

$("search").addEventListener("input", renderNews);
$("catalog-search").addEventListener("input", renderCatalog);
$("refresh").addEventListener("click", loadRadar);
$("story-select").addEventListener("change", () => {
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
      state.editingDraftId = null;
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
      signalStep(3, "Étape 3/4 · Brouillon enregistré", "Votre texte est sauvegardé. Vous pouvez maintenant vérifier son aperçu.");
      toast("Brouillon enregistré sur cet appareil.");
    }
    renderDrafts();
  } catch (error) {
    toast(error.message);
  }
});
$("preview-draft").addEventListener("click", () => {
  $("preview-title").textContent = $("draft-title").value.trim();
  $("preview-body").textContent = $("draft-body").value.trim();
  $("preview-tags").textContent = $("draft-tags").value;
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


$("export-recovery")?.addEventListener("click", exportStorageRecovery);
