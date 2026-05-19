/*
 * ═══════════════════════════════════════════════════════════════════
 *  ARIA IOT DEVICE TEMPLATE — Generic ESP32 Connector
 *  Mark 1.3
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Copy this file as a starting point for any new ESP32 project you
 *  want to connect to ARIA. Fill in the four blocks marked TODO:
 *    1. WiFi credentials
 *    2. Device metadata (name, type, capabilities)
 *    3. Telemetry — what status info you want to send
 *    4. handleCommand() — what the device does when ARIA sends commands
 *
 *  After flashing, the device shows up in:
 *    Settings → Devices → ESP32 Network
 *
 *  ARIA can then send commands to it from chat, e.g.:
 *    "set my speaker volume to 50"
 *    "turn the LED strip green"
 *
 *  Required libraries:
 *    WiFi (built-in)
 *    HTTPClient (built-in)
 *    ArduinoJson  ← install via Library Manager
 * ═══════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── 1. WIFI CREDENTIALS ────────────────────────────────────────────
WiFiMulti wifiMulti;
// TODO: replace with your networks
const char* WIFI_SSID_1 = "YourWifiSSID";
const char* WIFI_PASS_1 = "YourWifiPassword";

// ── 2. DEVICE METADATA ─────────────────────────────────────────────
// TODO: customize these per project
const char* SERVER_URL  = "https://your-aria.onrender.com";
const char* DEVICE_ID   = "esp32-speaker-01";      // unique ID
const char* DEVICE_NAME = "Living Room Speaker";   // human-readable
const char* DEVICE_TYPE = "speaker";               // free-form: "speaker", "sensor", "light", etc.
const char* PROJECT     = "bluetooth-speaker";     // your project name

// Capabilities the device supports — ARIA shows these in the UI
// and the LLM uses this list to know what commands to send.
const char* CAPABILITIES[] = {"play", "pause", "volume", "led_color"};
const int   CAP_COUNT      = 4;

// ── INTERNALS ──────────────────────────────────────────────────────
unsigned long lastHeartbeat = 0;
unsigned long lastPoll = 0;
const unsigned long HEARTBEAT_INTERVAL = 10000; // 10s
const unsigned long POLL_INTERVAL = 1500;       // 1.5s
bool registered = false;

// ───────────────────────────────────────────────────────────────────
//  REGISTRATION
// ───────────────────────────────────────────────────────────────────
bool registerWithARIA() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/devices/register");
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<512> doc;
  doc["deviceId"]   = DEVICE_ID;
  doc["name"]       = DEVICE_NAME;
  doc["type"]       = DEVICE_TYPE;
  doc["project"]    = PROJECT;
  doc["firmware"]   = "1.0.0";
  JsonArray caps    = doc.createNestedArray("capabilities");
  for (int i = 0; i < CAP_COUNT; i++) caps.add(CAPABILITIES[i]);

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  http.end();

  if (code == 200) {
    Serial.println("[ARIA] Registered ✓");
    return true;
  }
  Serial.printf("[ARIA] Register failed: %d\n", code);
  return false;
}

// ───────────────────────────────────────────────────────────────────
//  HEARTBEAT — send telemetry
// ───────────────────────────────────────────────────────────────────
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/devices/heartbeat");
  http.addHeader("Content-Type", "application/json");

  // ── 3. TELEMETRY ───────────────────────────────────────────────
  // TODO: add whatever you want ARIA to know about this device
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  JsonObject t = doc.createNestedObject("telemetry");
  t["uptimeMs"]  = millis();
  t["freeHeap"]  = ESP.getFreeHeap();
  t["rssi"]      = WiFi.RSSI();
  // Example custom fields for a speaker:
  // t["volume"]    = currentVolume;
  // t["nowPlaying"] = currentTrack;

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  http.end();
  if (code != 200) {
    Serial.printf("[ARIA] HB failed: %d — will re-register\n", code);
    registered = false;
  }
}

// ───────────────────────────────────────────────────────────────────
//  POLL — fetch commands from ARIA
// ───────────────────────────────────────────────────────────────────
void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/devices/queue?deviceId=" + DEVICE_ID);
  int code = http.GET();
  if (code != 200) { http.end(); return; }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<2048> doc;
  if (deserializeJson(doc, payload)) return;

  JsonArray cmds = doc["commands"].as<JsonArray>();
  for (JsonObject cmd : cmds) {
    handleCommand(cmd);
  }
}

// ───────────────────────────────────────────────────────────────────
//  4. HANDLE COMMAND — your custom logic per project
//     ARIA sends commands as JSON objects. The `type` field tells
//     you what action; other fields are params.
//     Example incoming command: { type: "volume", value: 75 }
// ───────────────────────────────────────────────────────────────────
void handleCommand(JsonObject cmd) {
  String type = cmd["type"] | "";
  Serial.print("[CMD] "); Serial.println(type);

  // TODO: handle whatever capabilities you declared above
  if (type == "ping") {
    Serial.println("Pong");
  }
  else if (type == "volume") {
    int value = cmd["value"] | 50;
    Serial.printf("Set volume to %d\n", value);
    // setVolume(value);
  }
  else if (type == "play") {
    Serial.println("Play");
    // playAudio();
  }
  else if (type == "pause") {
    Serial.println("Pause");
    // pauseAudio();
  }
  else if (type == "led_color") {
    int r = cmd["r"] | 0;
    int g = cmd["g"] | 0;
    int b = cmd["b"] | 0;
    Serial.printf("LED → %d,%d,%d\n", r, g, b);
    // setLED(r, g, b);
  }
  else {
    Serial.println("[CMD] Unknown");
  }
}

// ───────────────────────────────────────────────────────────────────
//  SETUP + LOOP
// ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ARIA-IOT] Booting…");

  wifiMulti.addAP(WIFI_SSID_1, WIFI_PASS_1);
  // wifiMulti.addAP(WIFI_SSID_2, WIFI_PASS_2);

  Serial.print("WiFi");
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(200);
    Serial.print(".");
  }
  Serial.print("\nIP: ");
  Serial.println(WiFi.localIP());

  for (int i = 0; !registered && i < 5; i++) {
    registered = registerWithARIA();
    if (!registered) delay(2000);
  }
}

void loop() {
  unsigned long now = millis();

  // Auto-reconnect WiFi
  if (WiFi.status() != WL_CONNECTED) {
    registered = false;
    wifiMulti.run();
    delay(100);
    return;
  }

  // Re-register if heartbeat fails
  if (!registered) {
    registered = registerWithARIA();
  }

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    sendHeartbeat();
  }
  if (now - lastPoll >= POLL_INTERVAL) {
    lastPoll = now;
    pollCommands();
  }

  delay(50);
}
