/*
 * ARIA CLAW — ESP32 NimBLE HID Relay v2.1
 *
 * IMPORTANT — BEFORE FLASHING:
 *   In Arduino IDE: Tools → Partition Scheme → "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   This sketch requires ~1.3MB of flash. The default 1MB partition is too small.
 *
 * Required libraries (Arduino Library Manager):
 *   - NimBLE-Arduino  by h2zero
 *   - ArduinoJson     by Benoit Blanchon
 *
 * Setup:
 *   1. Set WIFI_SSID, WIFI_PASS, SERVER_URL below
 *   2. Select partition scheme above
 *   3. Flash, then pair "ARIA Claw" in Bluetooth settings
 *
 * LED: fast blink = not paired | slow blink = ready | 3x flash = command received
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <NimBLEServer.h>
#include <NimBLEHIDDevice.h>

// ── USER CONFIG ───────────────────────────────────────────────
#define WIFI_SSID       "Sarvin"
#define WIFI_PASS       "tabletdomain540"
#define SERVER_URL      "https://your-aria.onrender.com"
#define POLL_MS         1500
#define DEVICE_ID       "esp32-hid-relay"
#define BLE_NAME        "ARIA Claw"
#define SCREEN_W        1920
#define SCREEN_H        1080
#ifndef LED_BUILTIN
  #define LED_BUILTIN   2
#endif
// ─────────────────────────────────────────────────────────────

#define RID_KB    1
#define RID_MOUSE 2

// Modifier bits
#define M_LCTRL  0x01
#define M_LSHIFT 0x02
#define M_LALT   0x04
#define M_LGUI   0x08
#define M_RCTRL  0x10
#define M_RSHIFT 0x20
#define M_RALT   0x40
#define M_RGUI   0x80

// HID keycodes
#define K_ENTER  0x28
#define K_ESC    0x29
#define K_BKSP   0x2A
#define K_TAB    0x2B
#define K_SPC    0x2C
#define K_DEL    0x4C
#define K_INS    0x49
#define K_HOME   0x4A
#define K_END    0x4D
#define K_PGUP   0x4B
#define K_PGDN   0x4E
#define K_RIGHT  0x4F
#define K_LEFT   0x50
#define K_DOWN   0x51
#define K_UP     0x52
#define K_CAPS   0x39
#define K_PRTSC  0x46
#define K_F1     0x3A

// Compact HID report descriptor — keyboard + mouse, one BLE device
static const uint8_t HID_DESC[] = {
  0x05,0x01,0x09,0x06,0xA1,0x01,0x85,RID_KB,
  0x05,0x07,0x19,0xE0,0x29,0xE7,0x15,0x00,0x25,0x01,0x75,0x01,0x95,0x08,0x81,0x02,
  0x95,0x01,0x75,0x08,0x81,0x03,
  0x95,0x05,0x75,0x01,0x05,0x08,0x19,0x01,0x29,0x05,0x91,0x02,
  0x95,0x01,0x75,0x03,0x91,0x03,
  0x95,0x06,0x75,0x08,0x15,0x00,0x25,0xFF,0x05,0x07,0x19,0x00,0x29,0xFF,0x81,0x00,
  0xC0,
  0x05,0x01,0x09,0x02,0xA1,0x01,0x09,0x01,0xA1,0x00,0x85,RID_MOUSE,
  0x05,0x09,0x19,0x01,0x29,0x03,0x15,0x00,0x25,0x01,0x95,0x03,0x75,0x01,0x81,0x02,
  0x95,0x01,0x75,0x05,0x81,0x03,
  0x05,0x01,0x09,0x30,0x09,0x31,0x09,0x38,0x15,0x81,0x25,0x7F,0x75,0x08,0x95,0x03,0x81,0x06,
  0xC0,0xC0
};

// BLE state
NimBLEServer*         pServer  = nullptr;
NimBLEHIDDevice*      pHID     = nullptr;
NimBLECharacteristic* pKbIn    = nullptr;
NimBLECharacteristic* pMsIn    = nullptr;
bool bleOK = false;

uint8_t kbR[8] = {0};  // [mod, reserved, key0..key5]
uint8_t msR[4] = {0};  // [buttons, dx, dy, wheel]

struct KR { uint8_t kc; uint8_t mod; };  // key result
struct AM { uint8_t kc; bool sh; };       // ascii map

class SvrCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    bleOK = true; Serial.println(F("[BLE] paired"));
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    bleOK = false; Serial.println(F("[BLE] lost"));
    NimBLEDevice::startAdvertising();
  }
};

void kbSend() {
  if (!bleOK || !pKbIn) return;
  pKbIn->setValue(kbR, 8); pKbIn->notify(); delay(8);
}
void kbClear() { memset(kbR, 0, 8); kbSend(); }
void msSend() {
  if (!bleOK || !pMsIn) return;
  pMsIn->setValue(msR, 4); pMsIn->notify(); delay(8);
}

void bleInit() {
  NimBLEDevice::init(BLE_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new SvrCB());
  pHID = new NimBLEHIDDevice(pServer);
  pHID->setManufacturer("ARIA");
  pHID->setPnp(0x02, 0x045E, 0x07A5, 0x0111);
  pHID->setHidInfo(0x00, 0x01);
  pHID->setReportMap((uint8_t*)HID_DESC, sizeof(HID_DESC));
  pKbIn = pHID->getInputReport(RID_KB);
  pMsIn = pHID->getInputReport(RID_MOUSE);
  pHID->setBatteryLevel(100);
  pHID->startServices();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAppearance(0x03C1);
  adv->addServiceUUID(pHID->getHidService()->getUUID());
  adv->start();
  Serial.println(F("[BLE] advertising"));
}

// ASCII → HID
static AM a2h(char c) {
  if (c>='a'&&c<='z') return {(uint8_t)(0x04 + c - 'a'),false};
  if (c>='A'&&c<='Z') return {(uint8_t)(0x04 + c - 'A'),true};
  if (c>='1'&&c<='9') return {(uint8_t)(0x1E + c - '1'),false};
  switch(c){
    case '0': return {0x27,false}; case ' ': return {K_SPC,false};
    case '\n':return {K_ENTER,false};case '\t':return {K_TAB,false};
    case '-': return {0x2D,false}; case '_': return {0x2D,true};
    case '=': return {0x2E,false}; case '+': return {0x2E,true};
    case '[': return {0x2F,false}; case '{': return {0x2F,true};
    case ']': return {0x30,false}; case '}': return {0x30,true};
    case'\\': return {0x31,false}; case '|': return {0x31,true};
    case ';': return {0x33,false}; case ':': return {0x33,true};
    case'\'': return {0x34,false}; case '"': return {0x34,true};
    case '`': return {0x35,false}; case '~': return {0x35,true};
    case ',': return {0x36,false}; case '<': return {0x36,true};
    case '.': return {0x37,false}; case '>': return {0x37,true};
    case '/': return {0x38,false}; case '?': return {0x38,true};
    case '!': return {0x1E,true};  case '@': return {0x1F,true};
    case '#': return {0x20,true};  case '$': return {0x21,true};
    case '%': return {0x22,true};  case '^': return {0x23,true};
    case '&': return {0x24,true};  case '*': return {0x25,true};
    case '(': return {0x26,true};  case ')': return {0x27,true};
  }
  return {0,false};
}

// Key name → HID
static KR kn2h(const String& nm) {
  // use first 4 chars lowercased for a compact switch
  String n = nm; n.toLowerCase();
  if(n=="ctrl"||n=="control")  return {0,M_LCTRL};
  if(n=="rctrl")               return {0,M_RCTRL};
  if(n=="shift")               return {0,M_LSHIFT};
  if(n=="rshift")              return {0,M_RSHIFT};
  if(n=="alt")                 return {0,M_LALT};
  if(n=="ralt"||n=="altgr")    return {0,M_RALT};
  if(n=="win"||n=="cmd"||n=="meta") return {0,M_LGUI};
  if(n=="rwin"||n=="rcmd")     return {0,M_RGUI};
  if(n=="enter"||n=="return")  return {K_ENTER,0};
  if(n=="esc"||n=="escape")    return {K_ESC,0};
  if(n=="tab")                 return {K_TAB,0};
  if(n=="space")               return {K_SPC,0};
  if(n=="backspace"||n=="bksp")return {K_BKSP,0};
  if(n=="delete"||n=="del")    return {K_DEL,0};
  if(n=="insert"||n=="ins")    return {K_INS,0};
  if(n=="home")                return {K_HOME,0};
  if(n=="end")                 return {K_END,0};
  if(n=="pgup"||n=="pageup")   return {K_PGUP,0};
  if(n=="pgdn"||n=="pagedown") return {K_PGDN,0};
  if(n=="up")                  return {K_UP,0};
  if(n=="down")                return {K_DOWN,0};
  if(n=="left")                return {K_LEFT,0};
  if(n=="right")               return {K_RIGHT,0};
  if(n=="capslock")            return {K_CAPS,0};
  if(n=="prtsc")               return {K_PRTSC,0};
  // F1-F12
  if(n.length()==2&&n[0]=='f'&&n[1]>='1'&&n[1]<='9')
    return {(uint8_t)(K_F1 + n[1] - '1'),0};
  if(n=="f10") return {(uint8_t)(K_F1 + 9),0};
  if(n=="f11") return {(uint8_t)(K_F1 + 10),0};
  if(n=="f12") return {(uint8_t)(K_F1 + 11),0};
  // single char fallback
  if(n.length()==1){ AM m=a2h(n[0]); return {m.kc,(uint8_t)(m.sh?M_LSHIFT:0)}; }
  return {0,0};
}

// Mouse button name → bit
static uint8_t btnBit(const String& b) {
  if(b=="right")  return 0x02;
  if(b=="middle") return 0x04;
  return 0x01;
}

// ── LED ───────────────────────────────────────────────────────
void ledFlash(int n) {
  for(int i=0;i<n;i++){
    digitalWrite(LED_BUILTIN,HIGH);delay(80);
    digitalWrite(LED_BUILTIN,LOW);delay(80);
  }
}

// ── WiFi ──────────────────────────────────────────────────────
void wifiConnect() {
  Serial.print(F("[WiFi] connecting"));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for(int i=0;i<40&&WiFi.status()!=WL_CONNECTED;i++){
    delay(500); Serial.print('.');
  }
  if(WiFi.status()==WL_CONNECTED){
    Serial.printf("\n[WiFi] %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("\n[WiFi] failed, rebooting"));
    delay(3000); ESP.restart();
  }
}

// ── ARIA comms ────────────────────────────────────────────────
bool registered = false;

bool ariaRegister() {
  if(WiFi.status()!=WL_CONNECTED) return false;
  HTTPClient h;
  h.begin(String(F(SERVER_URL)) + F("/api/claw/relay/register"));
  h.addHeader(F("Content-Type"),F("application/json"));
  String b = String(F("{\"deviceId\":\"")) + DEVICE_ID +
             F("\",\"platform\":\"esp32-nimble\",\"hostname\":\"") + BLE_NAME + F("\"}");
  int c = h.POST(b); h.end();
  if(c==200){ Serial.println(F("[ARIA] registered")); return true; }
  Serial.printf("[ARIA] reg fail %d\n",c);
  return false;
}

void ariaResult(const char* id, const char* res) {
  if(WiFi.status()!=WL_CONNECTED) return;
  HTTPClient h;
  h.begin(String(F(SERVER_URL)) + F("/api/claw/relay/result"));
  h.addHeader(F("Content-Type"),F("application/json"));
  String b = String(F("{\"deviceId\":\"")) + DEVICE_ID +
             F("\",\"cmdId\":\"") + id + F("\",\"result\":\"") + res + F("\"}");
  h.POST(b); h.end();
}

void ariaHeartbeat() {
  if(WiFi.status()!=WL_CONNECTED) return;
  HTTPClient h;
  h.begin(String(F(SERVER_URL)) + F("/api/claw/relay/heartbeat"));
  h.addHeader(F("Content-Type"),F("application/json"));
  h.POST(String(F("{\"deviceId\":\"")) + DEVICE_ID +
         F("\",\"ble\":") + (bleOK?F("true"):F("false")) + F("}"));
  h.end();
}

// ── Execute command ────────────────────────────────────────────
String execCmd(JsonObject cmd) {
  String t = cmd["type"] | "?";

  if(t=="type"||t=="keys") {
    if(!bleOK) return F("ble_nc");
    const char* txt = cmd["text"]|cmd["raw"]|"";
    for(int i=0;txt[i];i++){
      AM m=a2h(txt[i]); if(!m.kc) continue;
      kbR[0]=m.sh?M_LSHIFT:0; memset(kbR+2,0,6); kbR[2]=m.kc;
      kbSend(); kbClear(); delay(12);
    }
    return F("typed");
  }

  if(t=="hotkey") {
    if(!bleOK) return F("ble_nc");
    String toks[10]; int cnt=0;
    JsonArray arr=cmd["keys"];
    if(!arr.isNull()&&arr.size()>0){
      for(JsonVariant v:arr) if(cnt<10) toks[cnt++]=v.as<String>();
    } else {
      String raw=cmd["keys"]|cmd["raw"]|"";
      int s=0;
      for(int i=0;i<=(int)raw.length()&&cnt<10;i++){
        if(i==(int)raw.length()||raw[i]=='+'){
          String tok=raw.substring(s,i); tok.trim(); tok.toLowerCase();
          if(tok.length()) toks[cnt++]=tok; s=i+1;
        }
      }
    }
    if(!cnt) return F("no_keys");
    uint8_t mod=0; uint8_t kcs[6]={0}; int ki=0;
    for(int i=0;i<cnt;i++){
      KR r=kn2h(toks[i]); mod|=r.mod;
      if(r.kc&&ki<6) kcs[ki++]=r.kc;
    }
    kbR[0]=mod; kbR[1]=0; memcpy(kbR+2,kcs,6);
    kbSend(); delay(50); kbClear();
    return F("hotkey_sent");
  }

  if(t=="key_down") {
    if(!bleOK) return F("ble_nc");
    KR r=kn2h(String(cmd["key"]|""));
    kbR[0]|=r.mod;
    for(int i=2;i<8;i++) if(!kbR[i]){kbR[i]=r.kc;break;}
    kbSend(); return F("kd");
  }

  if(t=="key_up") {
    if(!bleOK) return F("ble_nc");
    KR r=kn2h(String(cmd["key"]|""));
    kbR[0]&=~r.mod;
    for(int i=2;i<8;i++) if(kbR[i]==r.kc){kbR[i]=0;break;}
    kbSend(); return F("ku");
  }

  if(t=="release_all") {
    kbClear(); memset(msR,0,4); if(bleOK) msSend();
    return F("released");
  }

  if(t=="mouse_move"||t=="move") {
    if(!bleOK) return F("ble_nc");
    int dx=cmd["dx"]|0, dy=cmd["dy"]|0;
    if(!dx&&!dy){
      dx=(int)(cmd["x"]|(SCREEN_W/2))-(SCREEN_W/2);
      dy=(int)(cmd["y"]|(SCREEN_H/2))-(SCREEN_H/2);
    }
    while(dx||dy){
      int sx=constrain(dx,-127,127),sy=constrain(dy,-127,127);
      msR[0]=0;msR[1]=(int8_t)sx;msR[2]=(int8_t)sy;msR[3]=0;
      msSend(); dx-=sx; dy-=sy;
    }
    return F("moved");
  }

  if(t=="mouse_click"||t=="click") {
    if(!bleOK) return F("ble_nc");
    uint8_t b=btnBit(String(cmd["button"]|"left"));
    int times=constrain((int)(cmd["times"]|1),1,5);
    for(int i=0;i<times;i++){
      msR[0]=b;msR[1]=0;msR[2]=0;msR[3]=0; msSend();
      delay(40); msR[0]=0; msSend();
      if(i<times-1) delay(60);
    }
    return F("clicked");
  }

  if(t=="mouse_down") {
    if(!bleOK) return F("ble_nc");
    msR[0]|=btnBit(String(cmd["button"]|"left"));
    msR[1]=0;msR[2]=0;msR[3]=0; msSend();
    return F("mdn");
  }

  if(t=="mouse_up") {
    if(!bleOK) return F("ble_nc");
    msR[0]&=~btnBit(String(cmd["button"]|"left"));
    msR[1]=0;msR[2]=0;msR[3]=0; msSend();
    return F("mup");
  }

  if(t=="scroll") {
    if(!bleOK) return F("ble_nc");
    int amt=cmd["amount"]|3;
    msR[0]=0;msR[1]=0;msR[2]=0;
    msR[3]=(int8_t)constrain((String(cmd["direction"]|"down")=="up"?amt:-amt),-127,127);
    msSend(); msR[3]=0;
    return F("scrolled");
  }

  if(t=="drag") {
    if(!bleOK) return F("ble_nc");
    int x1=cmd["x1"]|0,y1=cmd["y1"]|0,x2=cmd["x2"]|0,y2=cmd["y2"]|0;
    int dx=x1-(SCREEN_W/2),dy=y1-(SCREEN_H/2);
    while(dx||dy){
      int sx=constrain(dx,-127,127),sy=constrain(dy,-127,127);
      msR[0]=0;msR[1]=(int8_t)sx;msR[2]=(int8_t)sy;msR[3]=0;
      msSend();dx-=sx;dy-=sy;
    }
    delay(30); msR[0]=0x01;msR[1]=0;msR[2]=0;msR[3]=0; msSend(); delay(30);
    dx=x2-x1;dy=y2-y1;
    while(dx||dy){
      int sx=constrain(dx,-127,127),sy=constrain(dy,-127,127);
      msR[0]=0x01;msR[1]=(int8_t)sx;msR[2]=(int8_t)sy;msR[3]=0;
      msSend();dx-=sx;dy-=sy;delay(16);
    }
    delay(30);memset(msR,0,4);msSend();
    return F("dragged");
  }

  if(t=="shell") {
    Serial.printf("[SH] %s\n",(const char*)(cmd["cmd"]|cmd["raw"]|""));
    return F("sh_uart");
  }

  if(t=="wait"||t=="sleep") {
    delay(constrain((int)(cmd["ms"]|500),0,10000));
    return F("waited");
  }

  if(t=="ping") return bleOK ? F("pong_ok") : F("pong_nc");

  return "unk:" + t;
}

// ── Poll ──────────────────────────────────────────────────────
void poll() {
  if(WiFi.status()!=WL_CONNECTED){ wifiConnect(); return; }
  HTTPClient h;
  h.begin(String(F(SERVER_URL)) + F("/api/claw/queue?deviceId=") + DEVICE_ID);
  h.setTimeout(5000);
  int code=h.GET();
  if(code!=200){ h.end(); if(code>0) Serial.printf("[P] %d\n",code); return; }
  String pay=h.getString(); h.end();

  DynamicJsonDocument doc(6144);
  if(deserializeJson(doc,pay)) return;

  if(doc["killed"]|false){
    kbClear(); memset(msR,0,4); if(bleOK) msSend();
    return;
  }
  JsonArray cmds=doc["commands"];
  if(!cmds||!cmds.size()) return;

  ledFlash(3);
  for(JsonObject c:cmds){
    String id=c["id"]|"0";
    String res=execCmd(c);
    Serial.printf("[C] %s=%s\n",id.c_str(),res.c_str());
    ariaResult(id.c_str(),res.c_str());
    delay(20);
  }
}

// ─────────────────────────────────────────────────────────────
unsigned long tPoll=0,tHB=0,tLed=0;
bool ledSt=false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN,OUTPUT);
  Serial.println(F("[ARIA] CLAW v2.1 starting"));
  bleInit();
  wifiConnect();
  for(int i=0;!registered&&i<5;i++){ registered=ariaRegister(); if(!registered)delay(2000); }
  Serial.println(F("[ARIA] ready"));
}

void loop() {
  unsigned long now=millis();
  if(now-tPoll>=POLL_MS){ tPoll=now; poll(); }
  if(now-tHB>=10000){
    tHB=now; ariaHeartbeat();
    if(!registered) registered=ariaRegister();
  }
  unsigned long br=bleOK?2000:300;
  if(now-tLed>=br){ tLed=now; ledSt=!ledSt; digitalWrite(LED_BUILTIN,ledSt); }
  if(WiFi.status()!=WL_CONNECTED){ registered=false; wifiConnect(); ariaRegister(); }
  delay(10);
}
