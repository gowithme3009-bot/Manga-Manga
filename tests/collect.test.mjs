import test from "node:test";
import assert from "node:assert/strict";
import {decodeXml,parseFeed,rankItems} from "../scripts/collect.mjs";

test("decodeXml nettoie le HTML et décode les entités",()=>{
  assert.equal(decodeXml("<b>Manga</b> &amp; anime"),"Manga & anime");
});

test("parseFeed lit RSS et Atom sans inventer de lien",()=>{
  const source={id:"s1",name:"Source"};
  const rss=parseFeed("<rss><channel><item><title>Annonce manga</title><link>https://example.org/a</link><description><![CDATA[Résumé source.]]></description><pubDate>2026-11-11T10:00:00Z</pubDate></item></channel></rss>",source);
  assert.equal(rss.length,1);
  assert.equal(rss[0].title,"Annonce manga");
  assert.equal(rss[0].summary,"Résumé source.");
  const atom=parseFeed('<feed><entry><title>Anime news</title><link href="https://example.org/b"/><summary>Texte</summary></entry></feed>',source);
  assert.equal(atom[0].url,"https://example.org/b");
  assert.equal(parseFeed("<rss><item><title>Sans lien</title></item></rss>",source).length,0);
});

test("rankItems fusionne les titres identiques et valorise la couverture croisée",()=>{
  const now=Date.parse("2026-11-12T00:00:00Z");
  const items=[
    {title:"Nouvelle saison annoncée",url:"https://a.test/1",summary:"Résumé",source:"A",publishedAt:"2026-11-11T00:00:00Z"},
    {title:"Nouvelle saison annoncée!",url:"https://b.test/1",summary:"Résumé plus complet",source:"B",publishedAt:"2026-11-11T01:00:00Z"},
    {title:"Autre actualité",url:"https://c.test/2",summary:"",source:"C",publishedAt:"2026-11-01T00:00:00Z"}
  ];
  const ranked=rankItems(items,now);
  assert.equal(ranked.length,2);
  assert.equal(ranked[0].sourceCount,2);
  assert.equal(ranked[0].sources.length,2);
  assert.ok(ranked[0].trendScore>ranked[1].trendScore);
});
