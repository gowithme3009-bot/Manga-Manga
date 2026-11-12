import test from "node:test";
import assert from "node:assert/strict";
import {parseAiResponse,applyAiDrafts,auditAiDraft} from "../scripts/generate-ai-drafts.mjs";
const candidates=[{id:"one",title:"Annonce manga",summary:"Un manga sera adapté en anime."},{id:"two",title:"Annonce anime",summary:""}];
test("analyse le JSON et ignore les identifiants inconnus",()=>{
 const result=parseAiResponse(JSON.stringify({items:[
  {id:"one",editorialTitle:"Adaptation annoncée",body:"Le résumé indique une adaptation.",communityQuestion:"Votre avis ?",hashtags:"#Manga #Anime",verificationNotes:"Vérifier."},
  {id:"other",editorialTitle:"Intrus",body:"Texte"}]}),candidates);
 assert.equal(result.size,1);assert.equal(result.has("one"),true);assert.equal(result.has("other"),false);
});
test("aucun texte IA n’est déclaré prêt à publier",()=>{
 const parsed=parseAiResponse(JSON.stringify({items:[
  {id:"one",editorialTitle:"Adaptation annoncée",body:"Le résumé annonce une adaptation.",communityQuestion:"Votre avis ?",hashtags:"#Manga",verificationNotes:"Vérifier."},
  {id:"two",editorialTitle:"Annonce à confirmer",body:"Un sujet manga est évoqué.",communityQuestion:"Votre avis ?",hashtags:"#Anime",verificationNotes:"Lire l’article."}]}),candidates);
 const result=applyAiDrafts({items:candidates},parsed,"openai/gpt-oss-120b","2026-11-12T08:00:00.000Z");
 assert.equal(result.items[0].editorialReady,false);assert.match(result.items[0].status,/à relire/);
 assert.match(result.items[1].note,/Résumé RSS absent/);assert.match(result.items[1].status,/source à compléter/);
});
test("refuse une réponse IA sans proposition exploitable",()=>assert.throws(()=>parseAiResponse('{"items":[]}',candidates),/exploitable/i));
test("un résumé absent neutralise tout fait inventé par la réponse IA",()=>{
 const candidate={id:"empty",title:"Annonce manga à vérifier",summary:"",sourceVerification:{status:"publisher_unresolved",label:"Média d’origine non résolu"}};
 const parsed=parseAiResponse(JSON.stringify({items:[{id:"empty",editorialTitle:"Une adaptation déjà disponible",body:"Les épisodes sont déjà en ligne et rencontrent un grand succès.",communityQuestion:"Vous aimez ?",hashtags:"#Manga",verificationNotes:"Vérifier."}]}),[candidate]);
 const result=applyAiDrafts({items:[candidate]},parsed,"openai/gpt-oss-120b","2026-11-12T10:00:00.000Z");
 assert.match(result.items[0].text,/résumé de la source n’est pas disponible/i);
 assert.doesNotMatch(result.items[0].text,/rencontrent un grand succès|déjà en ligne/i);
 assert.equal(result.items[0].editorialReady,false);
 assert.equal(result.items[0].aiSourceStatus,"publisher_unresolved");
 assert.match(result.items[0].note,/page originale n’est pas vérifiée/i);
});
test("un extrait original vérifié ne signifie pas que l’article intégral a été lu",()=>{
 const candidate={id:"verified",title:"Annonce",summary:"Le projet est annoncé.",sourceVerification:{status:"original_page_excerpt_verified",label:"Extrait original récupéré"},articleContentRetrieved:true};
 const parsed=parseAiResponse(JSON.stringify({items:[{id:"verified",editorialTitle:"Projet annoncé",body:"Le projet est annoncé.",communityQuestion:"Votre avis ?",hashtags:"#Anime",verificationNotes:"Vérifier les détails."}]}),[candidate]);
 const result=applyAiDrafts({items:[candidate]},parsed,"openai/gpt-oss-120b","2026-11-12T10:00:00.000Z");
 assert.match(result.items[0].note,/article intégral n’a pas été lu/i);
 assert.equal(result.items[0].editorialReady,false);
});
test("repère un chiffre inventé absent du titre et de l’extrait",()=>{
 const audit=auditAiDraft({title:"Annonce de saison",summary:"La série est confirmée."},"La saison 4 sortira en 2028.");
 assert.equal(audit.status,"needs_check");
 assert.deepEqual(audit.unsupportedNumbers,["4","2028"]);
});
test("n’alerte pas sur les chiffres présents dans la source",()=>{
 const audit=auditAiDraft({title:"Saison 3 en 2027",summary:"Une série de 12 épisodes."},"La saison 3 est prévue en 2027 avec 12 épisodes.");
 assert.equal(audit.status,"no_numeric_alert");
 assert.deepEqual(audit.unsupportedNumbers,[]);
});
test("l’audit est explicitement limité et n’autorise jamais la publication",()=>{
 const candidate={id:"audit",title:"Annonce",summary:"Le projet est annoncé."};
 const parsed=new Map([["audit",{editorialTitle:"Annonce",body:"Le projet est annoncé.",communityQuestion:"Votre avis ?",hashtags:"#Anime",verificationNotes:"Vérifier."}]]);
 const result=applyAiDrafts({items:[candidate]},parsed,"model");
 assert.equal(result.items[0].aiAudit.status,"no_numeric_alert");
 assert.match(result.items[0].note,/ne valide pas les autres affirmations/i);
 assert.equal(result.items[0].editorialReady,false);
});
