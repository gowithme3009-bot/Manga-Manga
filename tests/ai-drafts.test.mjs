import test from "node:test";
import assert from "node:assert/strict";
import {parseAiResponse,applyAiDrafts} from "../scripts/generate-ai-drafts.mjs";
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
