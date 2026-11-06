const words = `
  alej andel banan barva bazen beran beton bobr borovice brana breza broskev
  brambora budik bukvice burak cedule cesta cibule cihla citron clun cuketa cukr
  datel destnik divadlo dlato domek drak drevo duben duha dunaj dvere dyne
  fazole fiala film flauta fotka gazela globus gorila granat had havran hlemyzd
  hodiny holub hora housle hrad hrasek hrbek hrnek hruska hvezda chata chleb
  chmel iglu inkoust jablko jahoda javor jazyk jelen jezero jezek jiskra jizba
  kachna kakao kamen kamna kapka kapr karta kastan kedlubna klavir klic klokan
  klubko kniha koberec kohout kolo komin konev kopr koral koruna kosik kostka
  kotva koza kozel krab kralik kreslo krida krtek kukurice kuna kuzel labut
  lahev lampa lano lavice led leden leknin len les letadlo lev lihen limeta
  lipa liska list lizatko lodka lopata losos louka lucerna luk lupa lusk
  mak malina mapa maslo med meduza meloun mesto mic miska mlha mlyn more
  most motyl mrak mravenec mrkev mys nadoba narcis nebe netopyr nit noc nos
  nudle oblak obraz okno okoun oliva orech orel ostrov osel oves palma papir
  papousek park pasek pastvina pavouk pec pecka pero petrzel pisek pivo plamen
  planeta plot pluh poleno pole police polstar potok pramen prase prkno prsten
  racek rak rakev rameno rano reka repa retizek retez reva robot roh rohlik
  rosa rovina ruze ryba rybnik rys salat satek sedlo seno sipka sirka skala
  sklo skokan slama slon sloup slunce smrk snezenka sova srna stan stin strom
  sud sukno svetlo svicka talir terasa ticho tykev tunel tulipan tuzka uhel
  uhor ulita uzel vaha valec vana varhany vaza vcelka vetev vitr vlak vlk vlna
  voda vozik vrata vrba vrch vrana vrtule vydra vylet zaba zahrada zajic zamek
  zebra zelva zidle zima zlato zvon
`
  .trim()
  .split(/\s+/);

// getRandomValues also works on HTTP in the local network, where randomUUID
// is unavailable. Rejection sampling avoids bias for any dictionary size.
export function generateNotificationTopic(random = globalThis.crypto) {
  const limit = 0x100000000 - (0x100000000 % words.length);
  const selected = [];
  const buffer = new Uint32Array(1);
  while (selected.length < 5) {
    random.getRandomValues(buffer);
    if (buffer[0] < limit) selected.push(words[buffer[0] % words.length]);
  }
  return selected.join("-");
}
