import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FEED_BYTES = 1_500_000;
const MAX_ITEMS_PER_FEED = 100;
export function decodeXml(value = "") {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
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
    const date = field(block,"pubDate") || field(block,"published") || field(block,"updated") || field(block,"dc:date");
    if (!title || !/^https:\/\//i.test(url)) return null;
    const key = crypto.createHash("sha256").update(title.toLocaleLowerCase("fr")).digest("hex").slice(0,20);
    const parsedDate = Date.parse(date);
    return {id:key,title,url,summary:summary.slice(0,1200),publishedAt:Number.isFinite(parsedDate)?new Date(parsedDate).toISOString():null,source:source.name,sourceId:source.id,category:"actualité"};
  }).filter(Boolean);
}
export function rankItems(items, now = Date.now()) {
  const groups = new Map();
  for (const item of items) {
    const key = item.title.normalize("NFKC").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu," ").trim();
    if (!key) continue;
    const group = groups.get(key) || {...item,sources:[],sourceCount:0};
    if (!group.sources.includes(item.source)) group.sources.push(item.source);
    if ((!group.summary || group.summary.length < (item.summary||"").length) && item.summary) group.summary = item.summary;
    if (!group.publishedAt || (item.publishedAt && Date.parse(item.publishedAt)>Date.parse(group.publishedAt))) group.publishedAt=item.publishedAt;
    groups.set(key,group);
  }
  return [...groups.values()].map(item => {
    item.sourceCount=item.sources.length;
    const published=Date.parse(item.publishedAt||"");
    const ageHours=Number.isFinite(published)?Math.max(0,(now-published)/3600000):720;
    const freshness=Math.max(0,100-Math.min(ageHours,720)/7.2);
    item.trendScore=Math.round(freshness + Math.min(item.sourceCount-1,4)*12);
    return item;
  }).sort((a,b)=>b.trendScore-a.trendScore || (Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)));
}
export async function collect({configPath=path.join(ROOT,"data/sources.json"),outputPath=path.join(ROOT,"data/latest-news.json"),fetchImpl=fetch,now=Date.now()}={}) {
  const config=JSON.parse(await fs.readFile(configPath,"utf8"));
  const active=(config.rssSources||[]).filter(s=>s.enabled && /^https:\/\//i.test(s.feedUrl||""));
  const items=[], sources=[], warnings=[];
  for (const source of active) {
    try {
      const response=await fetchImpl(source.feedUrl,{headers:{"User-Agent":"Manga-Manga-Studio/0.1 (+https://github.com/gowithme3009-bot/Manga-Manga)","Accept":"application/rss+xml, application/atom+xml, application/xml, text/xml"}});
      if(!response.ok) throw new Error("HTTP "+response.status);
      const xml=await readLimited(response);
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
