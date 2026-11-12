import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const SYSTEM_PROMPT = [
"Tu es l’assistant éditorial de Manga, Animé et Actualités, un média francophone.",
"Rédige des prépublications Facebook naturelles, claires, vivantes et professionnelles.",
"Utilise exclusivement les titres et extraits fournis depuis les flux RSS ou les métadonnées des pages originales.",
"Un extrait enrichi depuis la page originale apporte plus de contexte qu’un titre seul, mais ne représente pas nécessairement l’article complet.",
"Chaque phrase factuelle doit être directement soutenue par le titre ou l’extrait fourni. Si un détail n’y figure pas, ne l’ajoute pas, même s’il semble connu ou probable.",
"Ne complète jamais une information par des connaissances générales du modèle. N’ajoute aucun événement, épisode disponible, date de sortie, réaction, intention, lien narratif ou contexte absent des éléments fournis.",
"Privilégie une rédaction courte et précise plutôt qu’un texte plus long. Une seule information non confirmée suffit à rendre le brouillon incomplet.",
"Si l’extrait est une interview, attribue les propos à la personne interrogée et ne transforme pas une hypothèse ou une possibilité en annonce officielle.",
"Si la source originale est en anglais, rédige en français en traduisant fidèlement l’extrait ; conserve les noms propres et titres d’œuvres.",
"Ne prétends jamais avoir lu l’article intégral. Mentionne dans verificationNotes si l’extrait original est absent ou insuffisant.",
"Respecte le statut sourceVerification fourni : ne dis jamais qu’une source est vérifiée si son statut ne confirme pas une page originale.",
"N’invente jamais de date, chiffre, citation, nom, studio, auteur, plateforme, calendrier ou détail d’intrigue.",
"Si le résumé est vide ou trop pauvre, reformule uniquement le titre sans ajouter de fait et indique que l’information doit être confirmée dans l’article original.",
"Ne transforme jamais un signal de tendance en preuve de popularité ou de viralité. Les scores sont des indicateurs de fraîcheur/couverture, pas des compteurs de clics.",
"Écris en français, sans ton robotique, sans exagération ni clickbait trompeur. Ne prétends pas avoir lu la source complète.",
"Retourne exclusivement un objet JSON valide avec une propriété items. Chaque objet contient id, editorialTitle, body, communityQuestion, hashtags, verificationNotes.",
"editorialTitle : titre court et honnête, sans intensifier l’annonce. body : 1 à 2 courts paragraphes maximum adaptés à Facebook. Chaque phrase doit pouvoir être justifiée par les éléments de la source.",
"communityQuestion : question simple et pertinente. hashtags : 3 à 5 hashtags pertinents.",
"verificationNotes : ce qu’un humain doit contrôler avant publication. Aucun brouillon n’est prêt à publier automatiquement."
].join("\n");
export function parseAiResponse(content, candidates) {
 let parsed;
 try { parsed=JSON.parse(content); } catch {
  const start=content.indexOf("{"), end=content.lastIndexOf("}");
  if(start<0||end<=start) throw new Error("Réponse IA non JSON.");
  parsed=JSON.parse(content.slice(start,end+1));
 }
 if(!parsed||!Array.isArray(parsed.items)) throw new Error("Réponse IA sans liste items.");
 const allowed=new Set(candidates.map(x=>String(x.id))), clean=new Map();
 for(const item of parsed.items) {
  if(!item||!allowed.has(String(item.id))) continue;
  const value={
   editorialTitle:String(item.editorialTitle||"").trim().slice(0,180),
   body:String(item.body||"").trim().slice(0,5000),
   communityQuestion:String(item.communityQuestion||"").trim().slice(0,500),
   hashtags:String(item.hashtags||"#Manga #Anime #Actualités").trim().slice(0,250),
   verificationNotes:String(item.verificationNotes||"Relire l’article original et vérifier chaque détail.").trim().slice(0,1000)
  };
  if(value.editorialTitle&&value.body) clean.set(String(item.id),value);
 }
 if(!clean.size) throw new Error("L’IA n’a produit aucune proposition exploitable.");
 return clean;
}
// Contrôle déterministe limité : repère les chiffres du texte IA absents du titre et de l’extrait.
// Ce contrôle ne prouve pas la véracité sémantique et ne remplace jamais la lecture humaine.
export function auditAiDraft(candidate, body, editorialTitle="") {
 const source=String(candidate.title||"")+" "+String(candidate.summary||"");
 const sourceNumbers=new Set(source.match(/\b\d{1,4}(?:[.,]\d+)?\b/g)||[]);
 const draftText=String(editorialTitle||"")+" "+String(body||"");
 const bodyNumbers=[...new Set(draftText.match(/\b\d{1,4}(?:[.,]\d+)?\b/g)||[])];
 const unsupportedNumbers=bodyNumbers.filter(value=>!sourceNumbers.has(value));
 return {
  status:unsupportedNumbers.length?"needs_check":"no_numeric_alert",
  unsupportedNumbers,
  scope:"Contrôle automatique partiel des chiffres uniquement ; les affirmations et paraphrases doivent être vérifiées à la source."
 };
}
export function applyAiDrafts(data, generated, model, generatedAt=new Date().toISOString()) {
 const items=(data.items||[]).map(candidate=>{
  const draft=generated.get(String(candidate.id)); if(!draft) return candidate;
  const hasSummary=Boolean(String(candidate.summary||"").trim());
  const sourceVerified=candidate.sourceVerification?.status==="original_page_excerpt_verified";
  const safeBody=hasSummary?draft.body:"Sujet repéré : "+String(candidate.title||"Information à vérifier")+".\n\nLe résumé de la source n’est pas disponible. Le contenu doit être vérifié dans l’article original avant toute rédaction ou publication.";
  const safeTitle=hasSummary?draft.editorialTitle:String(candidate.title||"Sujet à vérifier")+" — à vérifier dans la source originale";
  const safeQuestion=hasSummary?draft.communityQuestion:"Que souhaitez-vous savoir sur ce sujet après vérification de l’article original ?";
  const safeHashtags=hasSummary?draft.hashtags:"#Manga #Anime #ÀVérifier";
  const text=[safeBody,safeQuestion?"Question à la communauté : "+safeQuestion:""].filter(Boolean).join("\n\n");
  const aiAudit=auditAiDraft(candidate,safeBody,safeTitle);
  const auditNote=aiAudit.unsupportedNumbers.length
   ?"Alerte automatique : chiffre(s) absent(s) du titre et de l’extrait fourni ("+aiAudit.unsupportedNumbers.join(", ")+"). Contrôle de la source obligatoire."
   :"Contrôle automatique des chiffres : aucune valeur numérique supplémentaire détectée. Cela ne valide pas les autres affirmations.";
  return {...candidate,aiGenerated:true,aiModel:model,aiGeneratedAt:generatedAt,aiTitle:safeTitle,text,aiSourceStatus:candidate.sourceVerification?.status||"rss_only_unverified",
   aiAudit,hashtags:safeHashtags,aiCommunityQuestion:draft.communityQuestion,aiVerificationNotes:draft.verificationNotes,
   editorialReady:false,status:hasSummary?"rédigé par IA · à relire":"préparation IA · source à compléter",
   note:["Prépublication rédigée par l’assistant IA à partir des éléments récupérés depuis la source.",
    candidate.articleContentRetrieved?(candidate.sourceLanguage==="en"?"Extrait de la page originale anglophone traduit en français ; ce n’est pas l’article intégral, vérifier les faits, noms et dates.":"Extrait récupéré depuis les métadonnées de la page originale ; ce n’est pas l’article intégral, vérifier les faits, noms et dates."):hasSummary?"Résumé RSS disponible mais incomplet : chaque phrase doit être comparée à la source originale.":"Résumé RSS absent ou inexploitable : texte automatique limité au titre, sans ajout de faits ; lire l’article original avant rédaction.",
    "Statut de provenance : "+(candidate.sourceVerification?.label||"Source originale non vérifiée")+".",sourceVerified?"Un extrait de la page originale a été récupéré, mais l’article intégral n’a pas été lu.":"La page originale n’est pas vérifiée : ne pas présenter les informations comme confirmées.",auditNote,draft.verificationNotes,"Validation humaine obligatoire. Aucune publication automatique."].join(" ")};
 });
 return {...data,aiGeneratedAt:generatedAt,aiModel:model,items};
}
export async function generateAiDrafts({inputPath=path.join(ROOT,"data/daily-drafts.json"),outputPath=path.join(ROOT,"data/daily-drafts.json"),
 apiKey=process.env.GROQ_API_KEY,model=process.env.GROQ_MODEL||DEFAULT_MODEL,fetchImpl=fetch}={}) {
 if(!apiKey){console.log("Assistant IA ignoré : secret GROQ_API_KEY absent. Propositions classiques conservées.");return {skipped:true,reason:"missing_api_key"};}
 const data=JSON.parse(await fs.readFile(inputPath,"utf8")), candidates=(data.items||[]).slice(0,4);
 if(!candidates.length) return {skipped:true,reason:"no_candidates"};
 const response=await fetchImpl(API_URL,{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
  body:JSON.stringify({model,temperature:0.35,max_completion_tokens:4200,response_format:{type:"json_object"},
   messages:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:JSON.stringify({instruction:"Rédige une prépublication Facebook concise et strictement fondée sur les éléments fournis. N’ajoute aucun fait absent du titre ou du résumé. Pour un résumé vide, propose uniquement un texte de préparation, sans information nouvelle. Respecte les identifiants.",
    proposals:candidates.map(x=>({id:String(x.id),title:x.title,summary:x.summary||"",summaryOrigin:x.summaryOrigin||"rss",articleUrl:x.sourceUrl||null,articleContentRetrieved:Boolean(x.articleContentRetrieved),sourceVerification:x.sourceVerification||{status:"rss_only_unverified"},publisherName:x.publisherName||null,sourceLanguage:x.sourceLanguage||"fr",language:"fr",sources:x.sourceNames||[],
     publishedAt:x.publishedAt||null,trendLevel:x.trendLevel||"surveillance",independentSourceCount:x.independentSourceCount||0,trendScore:x.trendScore||0}))})}]}),
  signal:AbortSignal.timeout(60000)});
 if(!response.ok) throw new Error("Groq API HTTP "+response.status+" : "+(await response.text()).slice(0,400));
 const payload=await response.json(), content=payload.choices?.[0]?.message?.content;
 if(typeof content!=="string"||!content.trim()) throw new Error("Réponse Groq vide.");
 const generated=parseAiResponse(content,candidates), result=applyAiDrafts(data,generated,model);
 await fs.writeFile(outputPath,JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify({aiGenerated:generated.size,candidates:candidates.length,model,note:"Vérification humaine obligatoire."},null,2));
 return {skipped:false,generated:generated.size,model};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 generateAiDrafts().catch(error=>{console.error("Assistant IA indisponible ; propositions RSS conservées :",error.message);process.exitCode=0;});
