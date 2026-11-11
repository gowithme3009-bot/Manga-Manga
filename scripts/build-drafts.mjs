import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export function buildDailyDrafts(items,generatedAt=new Date().toISOString()){
  const seen=new Set();
  const candidates=[];
  for(const item of items||[]){
    if(!item || typeof item.title!=="string" || typeof item.url!=="string" || !/^https:\/\//i.test(item.url)) continue;
    const summary=String(item.summary||"").replace(/\s+/g," ").trim().slice(0,450);
    if(!summary) continue;
    const key=item.id||item.url;
    if(seen.has(key)) continue;
    seen.add(key);
    const sources=Array.isArray(item.sources)?item.sources:(item.source?[item.source]:[]);
    candidates.push({
      id:String(key),title:item.title.trim(),summary,sourceUrl:item.url,
      sourceNames:sources,publishedAt:item.publishedAt||null,
      trendScore:Number.isFinite(item.trendScore)?item.trendScore:0,
      text:"📰 "+item.title.trim()+"\n\n"+summary+"\n\nLire la source originale : "+item.url+"\n\nQu'en pensez-vous ?",
      hashtags:"#Manga #Anime #Actualités",
      status:"à vérifier",
      note:"Brouillon extractif : le résumé provient du flux source. Vérification humaine obligatoire."
    });
  }
  candidates.sort((a,b)=>b.trendScore-a.trendScore);
  return {version:1,generatedAt,limit:4,eligibleCount:candidates.length,items:candidates.slice(0,40),warnings:candidates.length<4?["Moins de quatre articles avec résumé et lien HTTPS vérifiables : ne pas compléter avec des sujets inventés."]:[]};
}
export async function runBuild({inputPath=path.join(ROOT,"data/latest-news.json"),outputPath=path.join(ROOT,"data/daily-drafts.json")}={}){
  const input=JSON.parse(await fs.readFile(inputPath,"utf8"));
  const result=buildDailyDrafts(input.items,input.generatedAt||new Date().toISOString());
  await fs.writeFile(outputPath,JSON.stringify(result,null,2)+"\n");
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runBuild().then(r=>console.log(JSON.stringify({eligibleCount:r.eligibleCount,proposals:Math.min(r.eligibleCount,4),warnings:r.warnings},null,2))).catch(e=>{console.error(e);process.exitCode=1;});
}
