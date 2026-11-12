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

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name?.toLowerCase() === key.toLowerCase() && content) return decodeHtml(content);
  }
  return "";
}

function jsonLdDescriptions(html) {
  const results = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ""));
      const visit = value => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(visit);
        if (typeof value.description === "string") results.push(value.description);
        if (typeof value.articleBody === "string") results.push(value.articleBody);
        Object.values(value).forEach(visit);
      };
      visit(parsed);
    } catch { /* Ignore malformed publisher metadata. */ }
  }
  return results;
}

export function extractArticleText(html) {
  const candidates = [
    metaContent(html, "og:description"),
    metaContent(html, "description"),
    metaContent(html, "twitter:description"),
    ...jsonLdDescriptions(html)
  ].map(decodeHtml).filter(text => text.length >= 80);
  const useful = candidates.find(text => text.length >= 120) || candidates[0] || "";
  return useful.slice(0, MAX_EXCERPT);
}

async function fetchArticle(fetchImpl, initialUrl) {
  let current = safeArticleUrl(initialUrl);
  if (!current) return null;
  for (let hop = 0; hop <= 5; hop += 1) {
    const response = await fetchImpl(current.href, {
      redirect: "manual",
      headers: { "User-Agent": "Manga-Manga-Studio/0.1 (article metadata; contact via GitHub)", "Accept": "text/html,application/xhtml+xml" },
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
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return null;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_HTML_BYTES) return null;
    const html = new TextDecoder("utf-8").decode(bytes);
    const summary = extractArticleText(html);
    if (!summary) return null;
    return { url: response.url || current.href, summary };
  }
  return null;
}

export async function enrichItems(items, { fetchImpl = fetch, maxPages = MAX_PAGES } = {}) {
  const result = (items || []).map(item => ({ ...item }));
  let attempted = 0, enriched = 0;
  for (let index = 0; index < result.length && attempted < maxPages; index += 1) {
    const item = result[index];
    const summary = String(item.summary || "").replace(/\s+/g, " ").trim();
    if (summary.length >= 100 && !summary.toLowerCase().startsWith(String(item.title || "").toLowerCase().slice(0, 70))) continue;
    const url = item.articleUrl || item.url;
    if (!safeArticleUrl(url)) continue;
    attempted += 1;
    try {
      const article = await fetchArticle(fetchImpl, url);
      if (!article) continue;
      item.articleUrl = article.url;
      if (article.summary.length > summary.length) {
        item.summary = article.summary;
        item.summaryOrigin = "metadata_article_original";
        item.articleContentRetrieved = true;
        enriched += 1;
      }
    } catch (error) {
      item.articleFetchNote = error.name === "TimeoutError" || error.name === "AbortError" ? "Délai dépassé" : "Contenu original indisponible";
    }
  }
  return { items: result, attempted, enriched };
}

export async function runEnrichment({ inputPath = path.join(ROOT, "data/latest-news.json"), outputPath = inputPath, fetchImpl = fetch } = {}) {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = await enrichItems(data.items, { fetchImpl });
  await fs.writeFile(outputPath, JSON.stringify({ ...data, items: result.items, articleEnrichment: { attempted: result.attempted, enriched: result.enriched, maxPages: MAX_PAGES, excerptLimit: MAX_EXCERPT } }, null, 2) + "\n");
  console.log(JSON.stringify({ attempted: result.attempted, enriched: result.enriched, note: "Extraits courts issus des métadonnées des pages originales ; vérifier la source avant publication." }, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEnrichment().catch(error => { console.error("Enrichissement des articles indisponible :", error.message); process.exitCode = 0; });
}
