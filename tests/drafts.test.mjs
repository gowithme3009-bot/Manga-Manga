import test from "node:test";
import assert from "node:assert/strict";
import {buildDailyDrafts} from "../scripts/build-drafts.mjs";
test("prépare au maximum quatre propositions et garde la source",()=>{
 const items=Array.from({length:6},(_,i)=>({id:String(i),title:"Actualité "+i,url:"https://example.org/"+i,summary:"Résumé source "+i,trendScore:100-i}));
 const result=buildDailyDrafts(items,"2026-11-12T00:00:00.000Z");
 assert.equal(result.items.length,4);
 assert.equal(result.limit,4);
 assert.equal(result.items[0].sourceUrl,"https://example.org/0");
 assert.match(result.items[0].text,/Résumé source 0/);
});
test("ne fabrique pas quatre sujets si les sources sont insuffisantes",()=>{
 const result=buildDailyDrafts([{id:"1",title:"Titre",url:"https://example.org/a",summary:""}]);
 assert.equal(result.items.length,0);
 assert.equal(result.eligibleCount,0);
 assert.equal(result.warnings.length,1);
});
test("refuse les liens non HTTPS et dédoublonne",()=>{
 const items=[
 {id:"a",title:"Titre",url:"http://example.org/a",summary:"Texte"},
 {id:"b",title:"Titre",url:"https://example.org/b",summary:"Texte"},
 {id:"b",title:"Titre bis",url:"https://example.org/b",summary:"Texte"}
 ];
 assert.equal(buildDailyDrafts(items).items.length,1);
});
