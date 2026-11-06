#pragma once
void loadDisplayConfig() {
  Preferences p; p.begin("cov-display",false);
  apPassword=p.getString("ap-pass","");
  if(apPassword.isEmpty()){apPassword=randomToken(6);p.putString("ap-pass",apPassword);}
  JsonDocument doc;
  if(!deserializeJson(doc,p.getString("config","{}"))){ssid=doc["ssid"]|"";password=doc["password"]|"";serverUrl=doc["server"]|"";displayKey=doc["key"]|"";}
  p.end();
}
bool displayUrlValid(String url) {
  if(!url.startsWith("http://")||url.length()>200)return false;
  String host=url.substring(7);
  if(host.isEmpty()||host.startsWith("localhost")||host.startsWith("127."))return false;
  for(size_t i=0;i<host.length();i++){char c=host[i];if(!isalnum(c)&&c!='.'&&c!='-'&&c!=':')return false;}
  return true;
}
String resolveDisplayUrl(String url) {
  String authority=url.substring(7);int colon=authority.indexOf(':');
  String host=colon<0?authority:authority.substring(0,colon);
  String port=colon<0?"":authority.substring(colon);
  if(host.endsWith(".local")) {
    if(!mdnsReady) mdnsReady=MDNS.begin(("cov-display-"+String((uint32_t)ESP.getEfuseMac(),HEX)).c_str());
    IPAddress ip=MDNS.queryHost(host.substring(0,host.length()-6),1500);
    if(ip!=IPAddress(0,0,0,0))return "http://"+ip.toString()+port;
  }
  return url;
}
void startDisplaySetup() {
  if(setupActive)return;
  setupActive=true;setupStarted=millis();setupToken=randomToken(16);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(("COV-Display-"+String((uint32_t)ESP.getEfuseMac(),HEX)).c_str(),apPassword.c_str());
  WiFi.AP.enableDhcpCaptivePortal();dns.start(53,"*",WiFi.softAPIP());
  const char* headers[]={"X-Setup-Token","Origin"};web.collectHeaders(headers,2);
  auto page=[](){
    if(web.client().localIP()!=WiFi.softAPIP()){web.send(403,"text/plain","Use setup Wi-Fi");return;}
    String html=R"HTML(<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Displej ČOV</title><style>body{font:18px system-ui;max-width:32rem;padding:1rem;margin:auto}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0}label{display:block}</style><h1>Nastavení displeje</h1><p>Ve webu ČOV otevřete Nastavení → Připojení → Domácí displeje a vytvořte samostatný klíč.</p><form><label>Domácí Wi-Fi 2,4 GHz<input name="ssid" required maxlength="32"></label><label>Heslo Wi-Fi<input name="password" type="password" maxlength="64" autocomplete="new-password"></label><label>Server<input name="server" type="url" placeholder="http://raspberrypi.local:4173" required></label><label>Klíč displeje<input name="key" type="password" minlength="64" maxlength="64" required autocomplete="off"></label><button>Ověřit a uložit</button></form><p id="message" role="status"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button'),m=document.querySelector('#message');b.disabled=true;m.textContent='Ověřuji Wi-Fi a přístup k serveru…';try{const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':'__TOKEN__'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});const v=await r.json();if(!r.ok)throw Error(v.error);m.textContent='Uloženo. Displej se restartuje.'}catch(e){m.textContent=e.message}finally{b.disabled=false}};</script></html>)HTML";
    html.replace("__TOKEN__",setupToken);web.sendHeader("Cache-Control","no-store");web.send(200,"text/html; charset=utf-8",html);
  };
  web.on("/",HTTP_GET,page);web.onNotFound(page);
  web.on("/save",HTTP_POST,[](){
    if(web.client().localIP()!=WiFi.softAPIP()||web.header("X-Setup-Token")!=setupToken){web.send(403,"application/json","{\"error\":\"Otevřete znovu nastavovací stránku.\"}");return;}
    if(web.arg("plain").length()>2048){web.send(413,"application/json","{\"error\":\"Příliš velká zpráva.\"}");return;}
    JsonDocument doc;
    if(deserializeJson(doc,web.arg("plain"))){web.send(400,"application/json","{\"error\":\"Neplatná data.\"}");return;}
    String nextSsid=doc["ssid"]|"",nextPass=doc["password"]|"",url=doc["server"]|"",key=doc["key"]|"";
    while(url.endsWith("/"))url.remove(url.length()-1);
    bool keyValid=key.length()==64;for(size_t i=0;i<key.length();i++)if(!isxdigit((unsigned char)key[i]))keyValid=false;
    if(nextSsid.isEmpty()||nextSsid.length()>32||nextPass.length()>64||!displayUrlValid(url)||!keyValid){web.send(400,"application/json","{\"error\":\"Zkontrolujte SSID, adresu HTTP serveru a 64znakový klíč displeje.\"}");return;}
    WiFi.begin(nextSsid.c_str(),nextPass.c_str());unsigned long start=millis();
    while(WiFi.status()!=WL_CONNECTED&&millis()-start<15000)delay(20);
    if(WiFi.status()!=WL_CONNECTED){web.send(400,"application/json","{\"error\":\"Wi-Fi se nepřipojila. Zkontrolujte heslo.\"}");return;}
    String oldUrl=serverUrl,oldKey=displayKey;serverUrl=url;displayKey=key;fetchOverview();
    if(!linked){serverUrl=oldUrl;displayKey=oldKey;web.send(400,"application/json","{\"error\":\"Server nebo klíč displeje nefunguje. Ověřte adresu a oprávnění.\"}");return;}
    doc.clear();doc["ssid"]=nextSsid;doc["password"]=nextPass;doc["server"]=url;doc["key"]=key;
    String encoded;serializeJson(doc,encoded);Preferences p;p.begin("cov-display",false);size_t saved=p.putString("config",encoded);p.end();
    if(saved!=encoded.length()){web.send(500,"application/json","{\"error\":\"Uložení selhalo.\"}");return;}
    web.send(200,"application/json","{\"saved\":true}");delay(500);ESP.restart();
  });
  web.begin();paintOverview();
}
