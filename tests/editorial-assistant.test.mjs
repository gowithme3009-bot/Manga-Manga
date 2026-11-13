import test from "node:test";
import assert from "node:assert/strict";
import { detectEditorialIntent, findEditorialEvidence, buildEditorialAnswer } from "../js/editorial-assistant.js";

const catalog = [
 { type:"manga", name:"Naruto", aliases:["NARUTO -ナルト-"], url:"https://anilist.co/manga/300"},
 { type:"anime", name:"Naruto Shippuden", aliases:["Naruto"], url:"https://anilist.co/anime/1735"}
];
const articles = [{ title:"Naruto : une nouvelle annonce", summary:"Une actualité autour de Naruto.", sourceUrl:"https://example.test/naruto", sourceNames:["Média"] }];

test("reconnaît une demande de dernier tome",()=>{
 assert.equal(detectEditorialIntent("Naruto, dernier tome").type,"manga_volume");
});
test("associe Naruto au manga et non à la fiche anime",()=>{
 const result=findEditorialEvidence("Naruto, dernier tome",{catalog,articles});
 assert.equal(result.catalogMatches[0].type,"manga");
 assert.equal(result.catalogMatches[0].name,"Naruto");
});
test("n’invente jamais le numéro ni la date du dernier tome",()=>{
 const evidence=findEditorialEvidence("Naruto, dernier tome",{catalog,articles});
 const answer=buildEditorialAnswer("Naruto, dernier tome",evidence);
 assert.match(answer.message,/ne confirme ni le dernier tome publié en France/i);
 assert.match(answer.message,/pas inventer/i);
});
test("retourne les articles du radar correspondant à une œuvre",()=>{
 const result=findEditorialEvidence("Naruto actualité",{catalog,articles});
 assert.equal(result.articleMatches.length,1);
});
test("une recherche de tome ne traite pas une fiche anime comme un manga",()=>{
 const result=findEditorialEvidence("Naruto tome",{catalog:[catalog[1]],articles:[]});
 assert.equal(result.catalogMatches.length,0);
});
