/*
 * ═══════════════════════════════════════════════════════════════
 *  ARIA CLAW — ESP32 BLE HID Relay
 *  
 *  Connects to your WiFi, polls ARIA server for commands,
 *  executes them as a BLE keyboard + mouse (HID device).
 *
 *  Supported boards:
 *    - ESP32-S3 (recommended — better BLE)
 *    - ESP32-S2 (USB HID native via TinyUSB — see USB_MODE below)
 *    - Standard ESP32 (BLE only)
 *
 *  Required libraries (install via Arduino Library Manager):
 *    - ESP32-BLE-Keyboard  by T-vK     (search "BleKeyboard")
 *    - ESP32-BLE-Mouse     by T-vK     (search "BleMouse")
 *    - ArduinoJson         by Benoit Blanchon (search "ArduinoJson")
 *    - WiFi                (built-in ESP32)
 *    - HTTPClient          (built-in ESP32)
 *
 *  Setup:
 *    1. Fill in WIFI_SSID, WIFI_PASS, SERVER_URL below
 *    2. Flash to ESP32
 *    3. Pair "ARIA Claw" on your PC via Bluetooth settings
 *    4. ESP32 polls server every 1.5s for commands
 *
 *  LED indicators:
 *    BUILTIN_LED blinks = connecting WiFi
 *    BUILTIN_LED solid  = connected + paired
 *    Fast blink (3x)    = command executing
 * ═══════════════════════════════════════════════════════════════
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <BleKeyboard.h>
#include <BleMouse.h>

// ── USER CONFIG ───────────────────────────────────────────────
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"
#define SERVER_URL      "https://your-aria.onrender.com"  // no trailing slash
#define POLL_INTERVAL   1500    // ms between server polls
#define DEVICE_ID       "esp32-hid-relay"
#define BLE_DEVICE_NAME "ARIA Claw"
#define USB_MODE        false   // true = USB HID (ESP32-S2/S3 only, needs TinyUSB)
// ─────────────────────────────────────────────────────────────

BleKeyboard bleKB(BLE_DEVICE_NAME, "ARIA", 100);
BleMouse   bleM(BLE_DEVICE_NAME,  "ARIA", 100);

bool registered = false;
unsigned long lastPoll    = 0;
unsigned long lastHB      = 0;
unsigned long lastLedBlink = 0;
bool ledState = false;

// ── Key name → BLE keycode map ────────────────────────────────
struct KeyEntry { const char* name; uint8_t code; };
KeyEntry KEY_MAP[] = {
  {"ctrl",    KEY_LEFT_CTRL},   {"control", KEY_LEFT_CTRL},
  {"alt",     KEY_LEFT_ALT},    {"shift",   KEY_LEFT_SHIFT},
  {"win",     KEY_LEFT_GUI},    {"cmd",     KEY_LEFT_GUI},
  {"enter",   KEY_RETURN},      {"return",  KEY_RETURN},
  {"esc",     KEY_ESC},         {"escape",  KEY_ESC},
  {"tab",     KEY_TAB},         {"space",   ' '},
  {"backspace",KEY_BACKSPACE},  {"delete",  KEY_DELETE},
  {"up",      KEY_UP_ARROW},    {"down",    KEY_DOWN_ARROW},
  {"left",    KEY_LEFT_ARROW},  {"right",   KEY_RIGHT_ARROW},
  {"home",    KEY_HOME},        {"end",     KEY_END},
  {"pgup",    KEY_PAGE_UP},     {"pgdn",    KEY_PAGE_DOWN},
  {"insert",  KEY_INSERT},      {"f1",      KEY_F1},
  {"f2",      KEY_F2},          {"f3",      KEY_F3},
  {"f4",      KEY_F4},          {"f5",      KEY_F5},
  {"f6",      KEY_F6},          {"f7",      KEY_F7},
  {"f8",      KEY_F8},          {"f9",      KEY_F9},
  {"f10",     KEY_F10},         {"f11",     KEY_F11},
  {"f12",     KEY_F12},
};
#define KEY_MAP_LEN (sizeof(KEY_MAP)/sizeof(KEY_MAP[0]))

uint8_t keyNameToCode(const char* name) {
  for (int i = 0; i < KEY_MAP_LEN; i++) {
    if (strcasecmp(KEY_MAP[i].name, name) == 0) return KEY_MAP[i].code;
  }
  // Single char fallback
  if (strlen(name) == 1) return (uint8_t)name[0];
  return 0;
}

// ── LED helpers ───────────────────────────────────────────────
void ledFlash(int n, int onMs=80, int offMs=80) {
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_BUILTIN, HIGH); delay(onMs);
    digitalWrite(LED_BUILTIN, LOW);  delay(offMs);
  }
}

// ── WiFi connect ──────────────────────────────────────────────
void connectWifi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    digitalWrite(LED_BUILTIN, HIGH);
  } else {
    Serial.println("\n[WiFi] FAILED — rebooting in 5s");
    delay(5000);
    ESP.restart();
  }
}

// ── Register with ARIA server ─────────────────────────────────
bool registerRelay() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/claw/relay/register";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"deviceId\":\"" + String(DEVICE_ID) + "\","
                 "\"platform\":\"esp32\","
                 "\"hostname\":\"" + String(BLE_DEVICE_NAME) + "\"}";
  int code = http.POST(body);
  http.end();
  if (code == 200) {
    Serial.println("[ARIA] Registered with server ✓");
    return true;
  }
  Serial.printf("[ARIA] Register failed: %d\n", code);
  return false;
}

// ── Post result back to server ────────────────────────────────
void postResult(const char* cmdId, const char* result) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/claw/relay/result";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"deviceId\":\"" + String(DEVICE_ID) + "\","
                 "\"cmdId\":\"" + String(cmdId) + "\","
                 "\"result\":\"" + String(result) + "\"}";
  http.POST(body);
  http.end();
}

// ── Heartbeat ─────────────────────────────────────────────────
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/claw/relay/heartbeat";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.POST("{\"deviceId\":\"" + String(DEVICE_ID) + "\"}");
  http.end();
}

// ── Execute a single command ───────────────────────────────────
String executeCommand(JsonObject cmd) {
  String type = cmd["type"] | "unknown";

  // ── type / keys ──────────────────────────────────────────────
  if (type == "type" || type == "keys") {
    const char* text = cmd["text"] | cmd["raw"] | "";
    if (bleKB.isConnected()) {
      bleKB.print(text);
      return "typed";
    }
    return "kb_not_connected";
  }

  // ── hotkey ───────────────────────────────────────────────────
  if (type == "hotkey") {
    if (!bleKB.isConnected()) return "kb_not_connected";
    JsonArray keys = cmd["keys"];
    if (keys.isNull()) {
      // parse "ctrl+c" style
      String raw = cmd["keys"] | cmd["raw"] | "";
      // simple single key
      bleKB.press(keyNameToCode(raw.c_str()));
      delay(30);
      bleKB.releaseAll();
      return "hotkey_sent";
    }
    // Press all modifiers first, then the final key
    for (int i = 0; i < (int)keys.size() - 1; i++) {
      uint8_t code = keyNameToCode(keys[i]);
      if (code) bleKB.press(code);
    }
    uint8_t last = keyNameToCode(keys[keys.size()-1]);
    if (last) bleKB.press(last);
    delay(50);
    bleKB.releaseAll();
    return "hotkey_sent";
  }

  // ── mouse move ───────────────────────────────────────────────
  if (type == "mouse_move" || type == "move") {
    if (!bleM.isConnected()) return "mouse_not_connected";
    // BLE Mouse uses relative movement — compute delta from center assumption
    // For absolute positioning, use move(dx, dy)
    int dx = (int)(cmd["dx"] | 0);
    int dy = (int)(cmd["dy"] | 0);
    if (dx == 0 && dy == 0) {
      // absolute x,y given — convert to relative (assume 1920x1080 center)
      int x = cmd["x"] | 960;
      int y = cmd["y"] | 540;
      dx = x - 960;
      dy = y - 540;
    }
    // BLE HID mouse_move caps at -127..127 per report
    // Send in chunks if needed
    while (abs(dx) > 0 || abs(dy) > 0) {
      int sx = constrain(dx, -127, 127);
      int sy = constrain(dy, -127, 127);
      bleM.move(sx, sy);
      dx -= sx; dy -= sy;
      delay(8);
    }
    return "moved";
  }

  // ── mouse click ──────────────────────────────────────────────
  if (type == "mouse_click" || type == "click") {
    if (!bleM.isConnected()) return "mouse_not_connected";
    String btn = cmd["button"] | "left";
    uint8_t bleBtn = MOUSE_LEFT;
    if (btn == "right")  bleBtn = MOUSE_RIGHT;
    if (btn == "middle") bleBtn = MOUSE_MIDDLE;
    bleM.click(bleBtn);
    return "clicked";
  }

  // ── mouse scroll ─────────────────────────────────────────────
  if (type == "scroll") {
    if (!bleM.isConnected()) return "mouse_not_connected";
    String dir = cmd["direction"] | "down";
    int amt = cmd["amount"] | 3;
    int wheel = (dir == "up") ? amt : -amt;
    bleM.move(0, 0, wheel);
    return "scrolled";
  }

  // ── shell — ESP32 can't run shell, but can relay over UART ──
  if (type == "shell") {
    // Write command to Serial for a connected PC to execute optionally
    Serial.printf("[SHELL_RELAY] %s\n", (const char*)(cmd["cmd"] | cmd["raw"] | ""));
    return "shell_relayed_via_uart";
  }

  // ── wait/sleep ───────────────────────────────────────────────
  if (type == "wait" || type == "sleep") {
    int ms = cmd["ms"] | 500;
    delay(ms);
    return "waited";
  }

  // ── status ping ──────────────────────────────────────────────
  if (type == "ping") {
    return "pong_esp32";
  }

  return "unknown_type:" + type;
}

// ── Poll ARIA server for queued commands ──────────────────────
void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); return; }
  
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/claw/queue?deviceId=" + String(DEVICE_ID);
  http.begin(url);
  http.setTimeout(5000);
  int code = http.GET();
  
  if (code != 200) {
    http.end();
    if (code > 0) Serial.printf("[POLL] HTTP %d\n", code);
    return;
  }

  String payload = http.getString();
  http.end();

  // Parse JSON
  StaticJsonDocument<4096> doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.printf("[POLL] JSON parse error: %s\n", err.c_str());
    return;
  }

  // Kill signal
  if (doc["killed"] | false) {
    Serial.println("[CLAW] Kill signal received — halting");
    bleKB.releaseAll();
    return;
  }

  JsonArray commands = doc["commands"];
  if (!commands || commands.size() == 0) return;

  Serial.printf("[CLAW] Got %d command(s)\n", commands.size());
  ledFlash(3);  // signal incoming commands

  for (JsonObject cmd : commands) {
    String cmdId   = cmd["id"] | "0";
    String type    = cmd["type"] | "unknown";
    Serial.printf("[CMD] %s: %s\n", cmdId.c_str(), type.c_str());
    
    String result = executeCommand(cmd);
    Serial.printf("[RES] %s\n", result.c_str());
    postResult(cmdId.c_str(), result.c_str());
    delay(30);  // brief gap between commands
  }
}

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.println("\n╔══════════════════════════════╗");
  Serial.println("║  ARIA CLAW — ESP32 BLE HID   ║");
  Serial.println("╚══════════════════════════════╝");

  // Start BLE keyboard + mouse
  Serial.println("[BLE] Starting BLE HID...");
  bleKB.begin();
  bleM.begin();
  Serial.println("[BLE] Advertising as '" BLE_DEVICE_NAME "' — pair on your PC");

  // Connect WiFi
  connectWifi();

  // Register with ARIA
  int regTries = 0;
  while (!registered && regTries < 5) {
    registered = registerRelay();
    if (!registered) delay(2000);
    regTries++;
  }

  Serial.println("[ARIA] Ready. Polling every " + String(POLL_INTERVAL) + "ms");
}

void loop() {
  unsigned long now = millis();

  // Poll for commands
  if (now - lastPoll >= POLL_INTERVAL) {
    lastPoll = now;
    pollCommands();
  }

  // Heartbeat every 10s
  if (now - lastHB >= 10000) {
    lastHB = now;
    sendHeartbeat();
  }

  // LED: slow blink when BLE connected, fast when not
  unsigned long blinkRate = (bleKB.isConnected() && bleM.isConnected()) ? 2000 : 300;
  if (now - lastLedBlink >= blinkRate) {
    lastLedBlink = now;
    ledState = !ledState;
    digitalWrite(LED_BUILTIN, ledState);
  }

  // Re-register if WiFi dropped
  if (WiFi.status() != WL_CONNECTED) {
    registered = false;
    connectWifi();
    registerRelay();
  }

  delay(10);
}
