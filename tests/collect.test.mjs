import test from "node:test";
import assert from "node:assert/strict";
import {decodeXml,parseFeed,rankItems,readLimited,fetchFeedText} from "../scripts/collect.mjs";

test("decodeXml nettoie le HTML et décode les entités",()=>{
  assert.equal(decodeXml("<b>Manga</b> &amp; anime"),"Manga & anime");
  assert.equal(decodeXml("&lt;a href=\"https://example.org\"&gt;Titre manga&lt;/a&gt;&nbsp;— source"),"Titre manga — source");
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

test("readLimited arrête un flux qui dépasse la taille autorisée",async()=>{
  const response=new Response("123456789");
  await assert.rejects(()=>readLimited(response,4),/trop volumineux/);
});


test("interrompt un flux RSS qui ne répond pas dans le délai prévu", async () => {
  await assert.rejects(
    () => fetchFeedText((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }), "https://example.org/feed", { timeoutMs: 10 }),
    /Délai dépassé/
  );
});


test("rankItems distingue une tendance spectaculaire d'une tendance en hausse", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const coverage = ["A", "B", "C", "D", "E"].map((source, index) => ({
    title: "Annonce exceptionnelle anime",
    url: "https://" + source.toLowerCase() + ".test/news",
    source,
    publishedAt: new Date(now).toISOString()
  }));
  const [item] = rankItems(coverage, now);
  assert.equal(item.trendScore, 100);
  assert.equal(item.trendLevel, "spectaculaire");

  const [rising] = rankItems(coverage.slice(0, 2), now);
  assert.equal(rising.trendScore, 70);
  assert.equal(rising.trendLevel, "hausse");
});

test("un article récent isolé reste à surveiller, sans fausse hausse", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const [item] = rankItems([{
    title: "Annonce manga isolée", url: "https://a.test/news", source: "A",
    sourceId: "a-direct", publishedAt: new Date(now).toISOString()
  }], now);
  assert.equal(item.independentSourceCount, 1);
  assert.equal(item.trendLevel, "surveillance");
});

test("les agrégateurs Google Actualités ne comptent pas comme médias indépendants", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const [item] = rankItems([
    { title: "Annonce manga", url: "https://a.test/1", source: "Google Actualités", sourceId: "google-news-fr", publishedAt: new Date(now).toISOString() },
    { title: "Annonce manga", url: "https://b.test/1", source: "Annonces officielles", sourceId: "official-announcements", publishedAt: new Date(now).toISOString() }
  ], now);
  assert.equal(item.coverageSourceCount, 2);
  assert.equal(item.independentSourceCount, 0);
  assert.equal(item.trendLevel, "surveillance");
});
