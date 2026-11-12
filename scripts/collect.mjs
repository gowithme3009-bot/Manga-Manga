import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FEED_BYTES = 1_500_000;
const MAX_ITEMS_PER_FEED = 100;
const FEED_TIMEOUT_MS = 15_000;
export function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "’").replace(/&lsquo;/g, "‘")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ").trim();
}
function field(block, tag) {
  const escaped = tag.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp("<" + escaped + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + escaped + "\\s*>", "i"));
  return match ? decodeXml(match[1]) : "";
}
export async function readLimited(response,maxBytes=MAX_FEED_BYTES) {
  const length=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(length)&&length>maxBytes) throw new Error("Flux trop volumineux");
  if(!response.body){const value=await response.text();if(Buffer.byteLength(value)>maxBytes)throw new Error("Flux trop volumineux");return value;}
  const reader=response.body.getReader();const chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("Flux trop volumineux");}chunks.push(Buffer.from(value));}}finally{reader.releaseLock?.();}
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchFeedText(fetchImpl, url, { timeoutMs = FEED_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "Manga-Manga-Studio/0.1 (+https://github.com/gowithme3009-bot/Manga-Manga)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await readLimited(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Délai dépassé (" + Math.round(timeoutMs / 1000) + " s)");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseFeed(xml, source) {
  const entries = [
    ...[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => ({block:m[1],atom:false})),
    ...[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m => ({block:m[1],atom:true}))
  ].slice(0, MAX_ITEMS_PER_FEED);
  return entries.map(({block,atom}) => {
    const linkTag = block.match(/<link\b([^>]*)\/?\s*>/i);
    const href = linkTag?.[1]?.match(/href=["']([^"']+)["']/i)?.[1] || "";
    const url = atom ? href || field(block,"link") : field(block,"link") || href;
    const title = field(block,"title");
    const summary = field(block,"description") || field(block,"summary") || field(block,"content:encoded");
    const publisherTag = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source\s*>/i);
    const publisherName = publisherTag ? decodeXml(publisherTag[2]) : "";
    const publisherUrl = publisherTag?.[1]?.match(/url=["']([^"']+)["']/i)?.[1] || "";
    const date = field(block,"pubDate") || field(block,"published") || field(block,"updated") || field(block,"dc:date");
    if (!title || !/^https:\/\//i.test(url)) return null;
    if (source.id === "google-news-fr" && !/\b(manga|mangaka|shonen|shojo|seinen|isekai|webtoon|light novel)\b/i.test(title)) return null;
    const key = crypto.createHash("sha256").update(title.toLocaleLowerCase("fr")).digest("hex").slice(0,20);
    const parsedDate = Date.parse(date);
    return {id:key,title,url,summary:summary.slice(0,1200),publishedAt:Number.isFinite(parsedDate)?new Date(parsedDate).toISOString():null,source:source.name,sourceId:source.id,language:source.language||"und",publisherName:publisherName||null,publisherUrl:/^https:\/\//i.test(publisherUrl)?publisherUrl:null,category:"actualité"};
  }).filter(Boolean);
}
export function rankItems(items, now = Date.now()) {
  const groups = new Map();
  for (const item of items) {
    const key = item.title.normalize("NFKC").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu," ").trim();
    if (!key) continue;
    const group = groups.get(key) || {...item,sources:[],sourceIds:[],sourceCount:0};
    if (!group.sources.includes(item.source)) group.sources.push(item.source);
    const sourceId = item.sourceId || item.source;
    if (sourceId && !group.sourceIds.includes(sourceId)) group.sourceIds.push(sourceId);
    if ((!group.summary || group.summary.length < (item.summary||"").length) && item.summary) group.summary = item.summary;
    if (!group.publishedAt || (item.publishedAt && Date.parse(item.publishedAt)>Date.parse(group.publishedAt))) group.publishedAt=item.publishedAt;
    groups.set(key,group);
  }
  return [...groups.values()].map(item => {
    const isAggregator = value => /google.?news|google actualit|crunchyroll.*google|official-announcements|otaku-usa/i.test(String(value || ""));
    const sourceIds = item.sourceIds || item.sources || [];
    const independentSources = sourceIds.filter(source => !isAggregator(source));
    item.coverageSourceCount = item.sources.length;
    item.independentSourceCount = independentSources.length;
    item.sourceCount = item.independentSourceCount;
    const published=Date.parse(item.publishedAt||"");
    const ageHours=Number.isFinite(published)?Math.max(0,(now-published)/3600000):720;
    const freshness=60*Math.exp(-ageHours/24);
    item.trendScore=Math.round(Math.min(100, freshness + Math.min(Math.max(0,item.independentSourceCount-1),4)*10));
    item.trendLevel = item.independentSourceCount >= 3 && item.trendScore >= 75
      ? "spectaculaire"
      : item.independentSourceCount >= 2 && ageHours <= 48
        ? "hausse"
        : "surveillance";
    item.trendBasis = "fraîcheur et couverture de médias indépendants ; pas une mesure de croissance des clics";
    return item;
  }).sort((a,b)=>b.trendScore-a.trendScore || (Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)));
}
export async function collect({configPath=path.join(ROOT,"data/sources.json"),outputPath=path.join(ROOT,"data/latest-news.json"),fetchImpl=fetch,now=Date.now()}={}) {
  const config=JSON.parse(await fs.readFile(configPath,"utf8"));
  const active=(config.rssSources||[]).filter(s=>s.enabled && /^https:\/\//i.test(s.feedUrl||""));
  const items=[], sources=[], warnings=[];
  for (const source of active) {
    try {
      const xml=await fetchFeedText(fetchImpl, source.feedUrl);
      const parsed=parseFeed(xml,source);
      items.push(...parsed);
      sources.push({id:source.id,name:source.name,status:"ok",items:parsed.length});
    } catch(error) {
      sources.push({id:source.id,name:source.name,status:"error",items:0});
      warnings.push(source.name+": "+error.message);
    }
  }
  const result={version:1,generatedAt:new Date(now).toISOString(),items:rankItems(items,now).slice(0,100),sources,warnings};
  await fs.mkdir(path.dirname(outputPath),{recursive:true});
  await fs.writeFile(outputPath,JSON.stringify(result,null,2)+"\n");
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  collect().then(result=>console.log(JSON.stringify({items:result.items.length,sources:result.sources,warnings:result.warnings},null,2))).catch(error=>{console.error(error);process.exitCode=1;});
}
