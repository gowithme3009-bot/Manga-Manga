import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PAGES = 16;
const MAX_HTML_BYTES = 1_200_000;
const MAX_EXCERPT = 1_600;
const TIMEOUT_MS = 12_000;

function isPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "news.google.com" || host === "google.com" || host.endsWith(".google.com")) return false;
  const version = net.isIP(host);
  if (version === 4) {
    const parts = host.split(".").map(Number);
    return !(parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224);
  }
  if (version === 6) return !(host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"));
  return true;
}

export function safeArticleUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && isPublicHost(url.hostname) ? url : null;
  } catch { return null; }
}

function isGoogleNewsUrl(value) {
  try { const host = new URL(value).hostname.toLowerCase(); return host === "news.google.com" || host === "www.news.google.com"; }
  catch { return false; }
}

function extractGoogleOutboundUrl(html, baseUrl) {
  const source = String(html || "")
    .replace(/&amp;/gi, "&").replace(/&#x3a;/gi, ":").replace(/&#x2f;/gi, "/")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
  const candidates = [];
  for (const match of source.matchAll(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url\s*=\s*([^"']+)["'][^>]*>/gi)) candidates.push(match[1].trim());
  for (const match of source.matchAll(/\b(?:data-n-au|data-url|href)\s*=\s*["']([^"']+)["']/gi)) candidates.push(match[1].trim());
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/^['"]|['"]$/g, ""), baseUrl);
      const host = url.hostname.toLowerCase();
      if (!safeArticleUrl(url.href)) continue;
      if (host === "google.com" || host.endsWith(".google.com") || host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) continue;
      return url.href;
    } catch { /* Ignore malformed or unsafe candidates. */ }
  }
  return null;
}

export async function resolvePublisherUrl(fetchImpl, aggregatorUrl) {
  if (!isGoogleNewsUrl(aggregatorUrl)) return null;
  let current = new URL(aggregatorUrl);
  for (let hop = 0; hop <= 5; hop += 1) {
    const host = current.hostname.toLowerCase();
    if (host !== "news.google.com" && host !== "www.news.google.com" && !safeArticleUrl(current.href)) return null;
    const response = await fetchImpl(current.href, {
      redirect: "manual",
      headers: { "User-Agent": "Manga-Manga-Studio/0.3 (publisher source verification)", "Accept": "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 5) return null;
      try { current = new URL(location, current); } catch { return null; }
      continue;
    }
    if (!response.ok) return null;
    const responseUrl = response.url || current.href;
    const finalUrl = safeArticleUrl(responseUrl);
    if (finalUrl && !isGoogleNewsUrl(finalUrl.href)) return finalUrl.href;
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\\+xml/i.test(type)) return null;
    const html = await readHtmlLimited(response);
    if (html === null) return null;
    return extractGoogleOutboundUrl(html, current.href);
  }
  return null;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function metaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name?.toLowerCase() === key.toLowerCase() && content) return decodeHtml(content);
  }
  return "";
}

function jsonLdArticleText(html) {
  const results = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ""));
      const visit = value => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(visit);
        if (typeof value.articleBody === "string") results.push(value.articleBody);
        if (typeof value.description === "string") results.push(value.description);
        Object.values(value).forEach(visit);
      };
      visit(parsed);
    } catch { /* Ignore malformed publisher metadata. */ }
  }
  return results.map(decodeHtml).filter(isUsefulExcerpt);
}

function isUsefulExcerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 120) return false;
  if (/comprehensive up-to-date news coverage|aggregated from sources all over the world|google news|google actualit[eé]s|enable javascript|sign in to continue/i.test(text)) return false;
  return true;
}

export function extractArticleText(html, title = "") {
  const structured = jsonLdArticleText(html);
  const articleBlocks = [...String(html).matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(match => decodeHtml(match[2])).filter(isUsefulExcerpt);
  const metadata = [
    metaContent(html, "og:description"),
    metaContent(html, "description"),
    metaContent(html, "twitter:description")
  ].filter(isUsefulExcerpt);
  const candidates = [...structured, ...articleBlocks, ...metadata]
    .map(text => text.replace(/\s+/g, " ").trim())
    .filter(isUsefulExcerpt)
    .filter(text => !title || !text.toLocaleLowerCase("fr").startsWith(title.trim().toLocaleLowerCase("fr").slice(0, 70)));
  const useful = candidates.sort((a, b) => b.length - a.length)[0] || "";
  return useful.slice(0, MAX_EXCERPT);
}

async function readHtmlLimited(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) return null;
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= MAX_HTML_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchArticle(fetchImpl, initialUrl, title = "") {
  let current = safeArticleUrl(initialUrl);
  if (!current) return null;
  for (let hop = 0; hop <= 5; hop += 1) {
    const response = await fetchImpl(current.href, {
      redirect: "manual",
      headers: { "User-Agent": "Manga-Manga-Studio/0.2 (article source verification; contact via GitHub)", "Accept": "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 5) return null;
      current = safeArticleUrl(new URL(location, current).href);
      if (!current) return null;
      continue;
    }
    if (!response.ok) return null;
    const finalUrl = safeArticleUrl(response.url || current.href);
    if (!finalUrl) return null;
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return null;
    const html = await readHtmlLimited(response);
    if (html === null) return null;
    const summary = extractArticleText(html, title);
    if (!summary) return null;
    return { url: finalUrl.href, summary };
  }
  return null;
}

export async function enrichItems(items, { fetchImpl = fetch, maxPages = MAX_PAGES } = {}) {
  const result = (items || []).map(item => ({ ...item }));
  let attempted = 0, enriched = 0, skippedAggregator = 0;
  for (let index = 0; index < result.length && attempted < maxPages; index += 1) {
    const item = result[index];
    const summary = String(item.summary || "").replace(/\s+/g, " ").trim();
    const url = item.articleUrl || item.url;
    const aggregator = isGoogleNewsUrl(url);
    if (!aggregator && !safeArticleUrl(url)) continue;
    attempted += 1;
    try {
      const publisherUrl = aggregator ? await resolvePublisherUrl(fetchImpl, url) : url;
      if (!publisherUrl) {
        skippedAggregator += 1;
        item.sourceVerification = { status: "publisher_unresolved", label: "Média d’origine non identifié", checkedUrl: url };
        item.articleFetchNote = "Lien Google Actualités : redirection vers le média d’origine non résolue.";
        continue;
      }
      const article = await fetchArticle(fetchImpl, publisherUrl, item.title || "");
      if (!article) {
        item.sourceVerification = { status: "original_page_unavailable", label: "Page originale non vérifiée", checkedUrl: publisherUrl };
        item.articleFetchNote = "Aucun extrait éditorial fiable récupéré depuis la page du média.";
        continue;
      }
      item.articleUrl = article.url;
      item.sourceVerification = {
        status: "original_page_excerpt_verified",
        label: "Extrait récupéré sur le média d’origine",
        publisherHost: new URL(article.url).hostname,
        checkedUrl: article.url,
        scope: "Extrait de page vérifié ; lecture intégrale non effectuée."
      };
      if (article.summary.length > summary.length) {
        item.summary = article.summary;
        item.summaryOrigin = "metadata_article_original";
        item.articleContentRetrieved = true;
        item.articleFetchNote = "";
        enriched += 1;
      }
    } catch (error) {
      item.sourceVerification = { status: "verification_failed", label: "Vérification de la source impossible" };
      item.articleFetchNote = error.name === "TimeoutError" || error.name === "AbortError" ? "Délai dépassé" : "Contenu original indisponible";
    }
  }
  return { items: result, attempted, enriched, skippedAggregator };
}

export async function runEnrichment({ inputPath = path.join(ROOT, "data/latest-news.json"), outputPath = inputPath, fetchImpl = fetch } = {}) {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = await enrichItems(data.items, { fetchImpl });
  await fs.writeFile(outputPath, JSON.stringify({ ...data, items: result.items, articleEnrichment: { attempted: result.attempted, enriched: result.enriched, skippedAggregator: result.skippedAggregator, maxPages: MAX_PAGES, excerptLimit: MAX_EXCERPT } }, null, 2) + "\n");
  console.log(JSON.stringify({ attempted: result.attempted, enriched: result.enriched, skippedAggregator: result.skippedAggregator, note: "Les liens agrégateurs sont résolus vers le média d’origine lorsque possible ; les extraits ne remplacent pas la lecture intégrale." }, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEnrichment().catch(error => { console.error("Enrichissement des articles indisponible :", error.message); process.exitCode = 0; });
}
