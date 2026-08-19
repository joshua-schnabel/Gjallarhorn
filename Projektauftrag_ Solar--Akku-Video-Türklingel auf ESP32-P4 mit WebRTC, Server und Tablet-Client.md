# Projektauftrag

Du sollst ein vollständiges Softwareprojekt für eine netzwerkfähige Video-Türklingel entwickeln.

Das Gesamtsystem besteht aus drei von dir zu entwickelnden Softwarekomponenten:

1. **Firmware für das Türgerät auf Basis ESP32-P4**
2. **Server-/Backend-Komponente, vollständig per Docker betreibbar**
3. **Benutzeroberfläche für ein Android-Tablet**, vorzugsweise als browserbasierte PWA, sofern dies technisch sinnvoll ist; alternativ native Android-App

Die Hardware des Türgeräts wird bereitgestellt und muss nicht von dir entwickelt werden.

Wichtig: Beginne nicht sofort mit der vollständigen Implementierung. Führe zunächst die unten beschriebenen Architektur-Spikes durch, dokumentiere die Entscheidungen und entwickle anschließend iterativ.

---

# 1. Fachliches Ziel

Es soll eine solar- und akkubetriebene Video-Türklingel entstehen.

Das Türgerät besitzt mindestens:

- ESP32-P4 als Hauptprozessor
- Kamera
- Mikrofon
- Lautsprecher
- Klingeltaster
- Bewegungssensor, beispielsweise PIR
- Akku
- Solarladeversorgung
- Messmöglichkeit für Akkuzustand beziehungsweise Batteriespannung
- Netzwerkverbindung über die konkret bereitgestellte Hardware

Die exakten Pins, Sensoren, Kamera- und Audio-Komponenten werden später vorgegeben.

Die Firmware muss deshalb hardwareabhängige Implementierungen sauber von der Applikationslogik trennen.

---

# 2. Kernfunktionen

## 2.1 Klingeln

Beim Betätigen des Klingeltasters muss:

1. das Gerät gegebenenfalls aus einem Energiesparzustand aufwachen,
2. ein `doorbell`-Event erzeugt werden,
3. das Event an das Gesamtsystem übermittelt werden,
4. die Tablet-Oberfläche den Klingelvorgang deutlich anzeigen,
5. die Hausautomation über MQTT informiert werden,
6. für einen definierten Zeitraum eine Live-Kommunikation ermöglicht werden.

Mehrfachbetätigungen müssen entprellt werden.

---

# 3. Bewegungserkennung

Der externe Bewegungssensor erzeugt ein Motion-Ereignis.

Bei relevanter Bewegung soll:

1. das Gerät aufwachen,
2. die Kamera initialisiert werden,
3. ein Einzelbild aufgenommen werden,
4. das Bild mit Zeitstempel und Metadaten an den Server übertragen werden,
5. ein Motion-Event erzeugt werden,
6. das Ereignis gegebenenfalls per MQTT veröffentlicht werden,
7. das Gerät anschließend wieder in einen geeigneten Energiesparzustand wechseln.

Es muss eine konfigurierbare Sperrzeit beziehungsweise ein Cooldown vorgesehen werden, damit dauerhafte Bewegung nicht zu permanenten Aufnahmen führt.

Beispiel:

`motion -> wake -> capture -> upload -> event -> cooldown -> sleep`

Die Parameter müssen konfigurierbar sein.

---

# 4. Live-Video und Zwei-Wege-Audio

Das Türgerät muss Live-Video übertragen können.

Zusätzlich muss bidirektionales Audio möglich sein:

**Türgerät -> Tablet**

- Mikrofon
- Audiostream

**Tablet -> Türgerät**

- Tablet-Mikrofon
- Audiostream
- Wiedergabe über Lautsprecher des Türgeräts

Für diese Echtzeitkommunikation soll **WebRTC als bevorzugte Technologie untersucht werden**.

HTTP darf nicht künstlich für einen kontinuierlichen Audio-/Videostream verwendet werden, wenn WebRTC technisch die bessere Lösung ist.

REST/HTTP(S), WebRTC und MQTT dürfen unterschiedliche Aufgaben übernehmen.

---

# 5. ESP32-P4 und Espressif-WebRTC evaluieren

Untersuche zuerst die aktuelle offizielle Espressif-Lösung `esp-webrtc-solution`.

Die aktuelle Espressif-Lösung enthält unter anderem WebRTC-Komponenten und Beispiele für eine Türklingel sowie Janus-Integration.

Insbesondere sind zu evaluieren:

- `esp_peer`
- `esp_capture`
- `doorbell_demo`
- `doorbell_local`
- `janus_demo`
- eventuell weitere inzwischen vorhandene relevante Beispiele

Der ESP32-P4 besitzt Hardwareunterstützung für H.264-Encoding. Diese soll nach Möglichkeit verwendet werden.

Keine eigene WebRTC-Implementierung von Grund auf entwickeln, wenn die Espressif-Komponenten die Anforderungen sinnvoll abdecken.

---

# 6. Architektur-Spike A: WebRTC-Architektur

Vor der endgültigen Implementierung müssen mindestens folgende Varianten verglichen werden.

## Variante A – direkte WebRTC-Verbindung

ESP32-P4 und Browser/Tablet bauen nach erfolgtem Signaling eine möglichst direkte Peer-to-Peer-Verbindung auf.

Zu untersuchen:

- Latenz
- Komplexität
- Signaling
- ICE
- LAN-Betrieb
- Verhalten ohne Internet
- Browserkompatibilität
- bidirektionales Audio
- H.264-Kompatibilität
- Energiebedarf beim Verbindungsaufbau
- Wiederverbindungszeiten

---

## Variante B – Espressif-Doorbell-Architektur

Prüfe, ob sich die Architektur des offiziellen `doorbell_demo` unmittelbar als Basis verwenden beziehungsweise auf dieses Projekt anpassen lässt.

Das offizielle Beispiel ist ausdrücklich für Live-Video und Zwei-Wege-Audio vorgesehen.

Nicht nur den Quellcode kopieren, sondern prüfen:

- Welche Komponenten können direkt übernommen werden?
- Welche Teile sind Demo-spezifisch?
- Welcher Signaling-Mechanismus wird verwendet?
- Kann der Signaling-Server selbst betrieben werden?
- Wie gut passt die Lösung zu einem lokalen Docker-Backend?

---

## Variante C – Janus WebRTC Server

Janus muss ausdrücklich als ernsthafte Zielarchitektur untersucht werden.

Espressif stellt inzwischen ein `janus_demo` bereit, das einen ESP-WebRTC-Client mit Janus verbindet.

Mögliche Architektur:

`ESP32-P4 <---- WebRTC ----> Janus <---- WebRTC ----> Tablet/PWA`

Daneben:

`ESP32-P4 <-- HTTP --> Backend`

`Backend <-- API --> Tablet`

`Backend --> MQTT-Broker`

Janus soll dabei als dedizierter Media-/WebRTC-Dienst betrachtet werden, nicht als Ersatz für das Anwendungsbackend.

Zu evaluieren sind insbesondere:

- Janus VideoRoom
- gegebenenfalls andere passende Janus-Plugins
- H.264-Kompatibilität
- Audiocodec
- echtes bidirektionales Audio
- ESP als Publisher und gegebenenfalls Subscriber
- Browser als Publisher und Subscriber
- Signaling über HTTP oder WebSockets
- Session-Lifecycle
- Verbindungsaufbau
- Reconnect
- Docker-Betrieb
- UDP-Portbereiche
- ICE
- STUN/TURN
- ausschließlich lokaler LAN-Betrieb
- spätere optionale Remote-Nutzung

Beachte, dass Janus ein allgemeiner WebRTC-Server ist und die eigentliche Anwendungslogik weiterhin im eigenen Backend liegen sollte. Die Janus-Dokumentation beschreibt explizit solche serverseitigen Wrapper-Architekturen.

---

# 7. Ergebnis des WebRTC-Spikes

Erstelle:

`docs/adr/ADR-001-webrtc-architecture.md`

Vergleiche darin mindestens:

1. Direct WebRTC/P2P
2. Espressif Doorbell-Ansatz
3. Janus

Bewerte:

- Entwicklungsaufwand
- Stabilität
- Latenz
- Energieverbrauch
- Browserunterstützung
- Zwei-Wege-Audio
- Video
- Wartbarkeit
- LAN-only-Betrieb
- spätere Remote-Fähigkeit
- Docker-Betrieb
- Debugbarkeit

Gib anschließend eine eindeutige Empfehlung ab.

Die Architektur soll **nicht vorab gegen Janus oder gegen Direct WebRTC festgelegt werden**.

---

# 8. Architektur-Spike B: MQTT

MQTT wird zur Integration in die bestehende Hausautomation benötigt.

Der MQTT-Broker ist grundsätzlich als externer Dienst zu betrachten. Für Entwicklung und Tests darf optional ein Mosquitto-Container bereitgestellt werden.

Es sind drei Varianten zu vergleichen.

## Variante 1 – Backend publiziert MQTT

Datenfluss:

`ESP -> HTTP -> Backend -> MQTT`

Vorteile, die untersucht werden sollen:

- einfache Firmware
- zentrale Event-Normalisierung
- MQTT-Credentials nur auf dem Server
- einfache Änderung der Topics
- einheitliches Retry-/Logging-Verhalten

Nachteil:

Der Backend-Service liegt im kritischen Eventpfad.

---

## Variante 2 – Türgerät publiziert MQTT direkt

Datenfluss:

`ESP -> MQTT`

und parallel:

`ESP -> HTTP -> Backend`

Das Backend kann MQTT ebenfalls abonnieren.

Zu untersuchen:

- zusätzliche Verbindungskosten beim Aufwachen
- MQTT-Verbindungsaufbau
- Akkuverbrauch
- QoS
- Retained Messages
- Offline-Verhalten
- Credential-Management
- Firmware-Komplexität
- Entkopplung der Hausautomation vom Backend

---

## Variante 3 – Hybrid

Beispielsweise:

ESP veröffentlicht direkt nur:

- `doorbell`
- `motion`
- wichtige Statusinformationen

Bilder und umfangreichere Daten laufen über HTTP zum Backend.

Das Backend kann zusätzlich normalisierte MQTT-Events erzeugen.

Dabei muss verhindert werden, dass Events doppelt in der Hausautomation auftreten.

---

# 9. MQTT-Entscheidung

Erstelle:

`docs/adr/ADR-002-mqtt-architecture.md`

Treffe nach der Evaluierung eine Entscheidung.

**Vorläufige Präferenz für das MVP:**

`ESP -> HTTP -> Backend -> MQTT`

Der Grund ist, die Firmware und insbesondere den Wake-Zyklus zunächst möglichst einfach zu halten.

Diese Präferenz darf jedoch geändert werden, wenn Messungen oder technische Gründe zeigen, dass Direct MQTT die bessere Architektur ist.

Nicht aus Bauchgefühl entscheiden. Entscheidung dokumentieren.

---

# 10. MQTT Topic-Konzept

Entwickle ein versionierbares Topic-Schema.

Beispielsweise:

```text
doorbell/frontdoor/ring
doorbell/frontdoor/motion
doorbell/frontdoor/status
doorbell/frontdoor/telemetry
doorbell/frontdoor/battery
doorbell/frontdoor/connectivity
```

Payloads grundsätzlich als JSON.

Beispiel:

```json
{
  "deviceId": "frontdoor",
  "event": "ring",
  "timestamp": "2026-08-19T12:00:00Z",
  "batteryVoltage": 3.91,
  "rssi": -61
}
```

Die endgültige Struktur soll dokumentiert werden.

QoS und Retain-Verhalten pro Topic ausdrücklich festlegen.

---

# 11. Backend

Das Backend muss vollständig über Docker beziehungsweise Docker Compose gestartet werden können.

Beispielhafte logische Architektur:

```text
docker-compose
|
+-- backend
|
+-- janus             optional, falls ausgewählt
|
+-- mqtt-broker       nur optional für Entwicklung
|
+-- persistent-data
```

Die konkrete Programmiersprache des Backends darf nach technischer Bewertung gewählt werden.

Prioritäten:

- einfach
- robust
- gut wartbar
- geringe Betriebsabhängigkeiten
- gute REST-Unterstützung
- gute MQTT-Unterstützung
- einfache Janus-Integration

---

# 12. Backend-Funktionen

Das Backend übernimmt mindestens:

- Geräteverwaltung
- Eventannahme
- Snapshot-Annahme
- Bildspeicherung
- Eventhistorie
- Telemetriespeicherung
- Gerätestatus
- MQTT-Publishing beziehungsweise MQTT-Integration
- Konfiguration
- Live-Session-Koordination
- gegebenenfalls Janus-Steuerung
- Health Checks
- Logging

---

# 13. Datenhaltung

Für das MVP möglichst einfach halten.

Bevorzugtes Modell:

- Metadaten und Events: SQLite oder vergleichbar leichtgewichtig
- Bilder: Dateisystem/Volume
- Dateireferenz in der Datenbank

Kein unnötig komplexes Datenbanksystem einführen.

Docker-Volumes müssen dafür sorgen, dass Daten einen Container-Neustart überleben.

---

# 14. Vorgeschlagene REST-API

Entwickle eine versionierte API, beispielsweise unter:

```text
/api/v1/
```

Mindestens folgende Anwendungsfälle müssen abgedeckt werden:

```text
POST /api/v1/devices/{id}/events
POST /api/v1/devices/{id}/snapshots
POST /api/v1/devices/{id}/telemetry

GET  /api/v1/devices
GET  /api/v1/devices/{id}
GET  /api/v1/events
GET  /api/v1/snapshots
GET  /api/v1/snapshots/{id}

POST /api/v1/devices/{id}/live/start
POST /api/v1/devices/{id}/live/stop

GET  /api/v1/health
```

Das ist ein Ausgangspunkt, keine starre Vorgabe.

Erstelle eine OpenAPI-Spezifikation.

---

# 15. Türgerät-Firmware

Die Firmware soll modular aufgebaut werden.

Beispiel:

```text
application/
    event_manager
    state_machine
    power_manager
    live_session

drivers/
    camera
    audio
    motion
    button
    battery

network/
    network_manager
    http_client
    mqtt_client        falls benötigt
    webrtc
    signaling

config/
    board_config
    application_config
```

Pins oder konkrete Bausteine dürfen nicht quer über den Code verteilt werden.

---

# 16. Zustandsautomat des Türgeräts

Definiere einen nachvollziehbaren Zustandsautomaten.

Mindestens:

```text
BOOT
INITIALIZING
IDLE
LOW_POWER
WAKE_MOTION
WAKE_DOORBELL
CAPTURING
UPLOADING
READY_FOR_LIVE
LIVE_SESSION
SESSION_ENDING
ERROR_RECOVERY
```

Die exakte Struktur darf verbessert werden.

Ziel ist, dass jederzeit klar ist:

- warum das Gerät wach ist,
- welche Komponenten eingeschaltet sein müssen,
- wann Kamera und Audio aktiv sind,
- wann Netzwerk benötigt wird,
- wann wieder geschlafen werden kann.

---

# 17. Energiemanagement

Energieeffizienz ist eine Kernanforderung und kein späteres Optimierungsdetail.

Das Gerät wird per Akku und Solar betrieben.

Daher:

- Kamera nicht permanent betreiben
- Videostream nicht permanent betreiben
- Audio nicht permanent betreiben
- Netzwerkverbindungen nur so lange wie sinnvoll aktiv halten
- Sleep-Modi des ESP32-P4 untersuchen
- Wakeup über Taster und Bewegungssensor untersuchen
- gegebenenfalls LP-Core sinnvoll verwenden
- Startzeiten messen
- Stromaufnahme der Zustände dokumentieren

Der ESP32-P4 verfügt über einen separaten Low-Power-Core und entsprechende Low-Power-Funktionen, die bei der Architektur berücksichtigt werden sollen.

---

# 18. Wichtige Produktentscheidung: Live-View vs. Energie

Ein beliebiger spontaner Live-Aufruf vom Tablet, während das Türgerät tief schläft, ist nicht automatisch möglich.

Deshalb muss ausdrücklich ein Betriebsmodell definiert werden.

MVP-Vorschlag:

Nach einem

- Klingelereignis oder
- Bewegungsevent

bleibt das Gerät für ein konfigurierbares Zeitfenster erreichbar, beispielsweise:

```text
60–120 Sekunden
```

Innerhalb dieses Fensters kann eine Live-WebRTC-Session gestartet werden.

Danach beendet das Gerät die Session und geht wieder schlafen.

Zusätzlich evaluieren:

- permanentes Standby
- periodisches Wakeup
- externe Wakeup-Möglichkeiten
- Auswirkungen auf Akkulaufzeit

Keinen „jederzeit verfügbaren Live-Stream“ versprechen, ohne dessen Energiebedarf zu messen.

---

# 19. Netzwerkabstraktion

Die Firmware darf keine unnötige Annahme treffen, dass die Netzwerkhardware direkt Bestandteil des ESP32-P4 ist.

Das offizielle ESP32-P4 Function EV Board verwendet beispielsweise ein separates ESP32-C6-Modul für Wi-Fi/Bluetooth.

Deshalb:

```text
NetworkInterface
    connect()
    disconnect()
    is_connected()
    get_rssi()
```

oder vergleichbare Abstraktion verwenden.

Die konkrete Verbindung kann danach auf die vorhandene Hardware angepasst werden.

---

# 20. Zuverlässigkeit

Das Türgerät muss mit folgenden Situationen umgehen können:

- Backend nicht erreichbar
- MQTT nicht erreichbar
- Wi-Fi nicht erreichbar
- WebRTC-Verbindungsaufbau schlägt fehl
- Janus nicht erreichbar
- Snapshot-Upload schlägt fehl
- Server startet neu
- Tablet trennt Verbindung
- Benutzer nimmt Klingeln nicht an

Keine Endlosschleifen mit permanentem Netzwerk-Retry erzeugen, die den Akku leeren.

Retries müssen begrenzt und energieverträglich sein.

---

# 21. Lokale Zwischenspeicherung

Prüfe eine kleine Event-/Upload-Queue im Türgerät.

Beispielsweise:

```text
motion event
snapshot
upload failed
=> locally queued
=> later retry
```

Die Queue muss begrenzt sein.

Ein Ausfall des Servers darf nicht dazu führen, dass der Flash unbegrenzt vollläuft.

---

# 22. Tablet-/Browser-Anwendung

Zunächst evaluieren:

## PWA

Vorteile:

- direkt im Android-Browser nutzbar
- einfacher WebRTC-Support
- einfache Verteilung
- plattformunabhängig

## Native Android

Prüfen, ob eine native App erforderlich ist für:

- zuverlässige lokale Benachrichtigungen
- Kiosk-Modus
- Hintergrundbetrieb
- Audio
- Bildschirmaktivierung
- bessere Integration in Android

Für das MVP darf eine PWA bevorzugt werden, sofern die Anforderungen damit sauber lösbar sind.

Dokumentiere die Entscheidung:

`docs/adr/ADR-003-client-platform.md`

---

# 23. UI des Tablets

Mindestens folgende Ansichten:

## Startseite

- Gerätestatus
- Online/Offline
- Akkustatus
- letzter Kontakt
- letzte Bewegung
- letzter Klingelvorgang

## Klingelansicht

Bei aktivem Klingeln:

- großes Live-Bild
- „Sprechen“
- „Audio stumm“
- „Auflegen“

Optional:

- Vollbild

## Historie

Anzeige von:

- Bewegungsereignissen
- Klingelereignissen
- Vorschaubildern
- Zeitstempel

---

# 24. Klingel-Benachrichtigung

Wenn die Tablet-Anwendung geöffnet ist, muss ein Klingelereignis unmittelbar sichtbar werden.

Dafür sind mögliche Mechanismen zu evaluieren:

- WebSocket/SSE vom Backend zur PWA
- MQTT over WebSocket
- andere lokale Push-Mechanismen

MQTT muss nicht zwangsläufig direkt im Browser verwendet werden.

Die Hausautomation und die Benutzeroberfläche dürfen unterschiedliche Event-Verteilungswege verwenden.

---

# 25. Sicherheit

Das System ist zunächst LAN-first.

HTTP darf während lokaler Entwicklung unterstützt werden.

Die Architektur muss aber HTTPS ermöglichen.

Mindestens vorsehen:

- Device-ID
- Device-Credential beziehungsweise Token
- Authentifizierung der Tablet-Anwendung
- keine Passwörter im Git-Repository
- Secrets über Environment/Secret-Dateien
- Eingabevalidierung
- Upload-Limits
- Dateitypprüfung
- Session-Timeouts

Bei WebRTC die vorhandenen Sicherheitsmechanismen des Protokolls verwenden und nicht versuchen, einen eigenen Verschlüsselungsmechanismus für die Medienübertragung zu erfinden.

---

# 26. Konfiguration

Zentrale Konfigurationswerte:

```text
DEVICE_ID
BACKEND_URL
DEVICE_TOKEN

MOTION_COOLDOWN
LIVE_SESSION_TIMEOUT
WAKE_WINDOW

CAMERA_RESOLUTION
VIDEO_FPS
VIDEO_BITRATE

MQTT_HOST
MQTT_PORT
MQTT_USERNAME
MQTT_PASSWORD
MQTT_BASE_TOPIC

JANUS_URL
JANUS_AUTH
```

Nur relevante Werte auf der jeweiligen Komponente verwenden.

---

# 27. Logging und Diagnose

Firmware:

- Boot-Grund
- Wake-Grund
- Netzwerkstatus
- Uploadstatus
- WebRTC-Status
- Speicherinformationen
- Batteriemessung
- Fehlercodes

Backend:

- strukturierte Logs
- Request-ID
- Device-ID
- Event-ID
- Session-ID

Janus:

Monitoring-/Admin-Funktionen nur intern zugänglich machen.

---

# 28. Repository-Struktur

Bevorzugt ein Monorepository:

```text
/
├── firmware/
├── server/
├── client/
├── deploy/
│   ├── docker-compose.yml
│   └── ...
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   └── testing/
└── README.md
```

---

# 29. Entwicklungsphasen

## Phase 0 – Architektur und technische Spikes

Noch keine vollständige Produktimplementierung.

Ergebnisse:

- ADR-001 WebRTC
- ADR-002 MQTT
- ADR-003 Client/PWA
- Datenflussdiagramm
- Zustandsdiagramm
- API-Entwurf
- MQTT-Spezifikation

---

## Phase 1 – Basis-Firmware

Implementieren:

- Hardware-Abstraktionen
- Button
- Motion
- Kamera
- Snapshot
- Akku-Telemetrie
- Netzwerk
- HTTP-Client
- Power-State-Machine

Ziel:

```text
Motion
-> Wake
-> Snapshot
-> HTTP upload
-> Sleep
```

und:

```text
Button
-> Wake
-> doorbell event
-> Backend
```

---

## Phase 2 – Backend

Implementieren:

- Docker
- API
- Eventpersistenz
- Snapshotpersistenz
- Telemetrie
- MQTT
- Health Checks
- Tests

End-to-End:

```text
ESP button
-> Backend
-> MQTT
```

sowie:

```text
ESP motion
-> Snapshot
-> Backend
-> Persistenz
-> UI
```

---

## Phase 3 – Client

Implementieren:

- Gerätestatus
- Klingelereignis
- Motion-Historie
- Snapshot-Historie
- Fehleranzeige
- Reconnect

Noch ohne perfekte WebRTC-Integration möglich.

---

## Phase 4 – WebRTC

Jetzt die in ADR-001 gewählte Architektur implementieren.

Ziel:

```text
ESP camera -> Tablet
ESP microphone -> Tablet
Tablet microphone -> ESP speaker
```

Latenz und Verbindungsaufbau messen.

---

## Phase 5 – Janus-Integration

Falls Janus aus ADR-001 gewählt wurde:

- Janus-Container
- Konfiguration
- Backend-Integration
- Session-Erstellung
- ESP-Anbindung
- Browser-Anbindung
- Cleanup
- Reconnect
- Monitoring

Docker Compose muss das Gesamtsystem reproduzierbar starten.

---

## Phase 6 – Power Optimization

Messen:

- Deep Sleep
- Idle
- Motion Wake
- Snapshot
- WLAN-/Netzwerkaufbau
- Upload
- WebRTC Idle
- WebRTC Video
- WebRTC Audio/Video

Erstelle:

`docs/power-budget.md`

Dort dokumentieren:

- Strom beziehungsweise Leistung pro Zustand
- typische Dauer
- angenommene Events pro Tag
- geschätzter Tagesenergiebedarf

Keine Akkulaufzeiten erfinden. Aus Messwerten berechnen.

---

## Phase 7 – Robustheit

Testen:

- Netzwerkverlust
- Backend-Neustart
- Janus-Neustart
- MQTT-Ausfall
- mehrfaches Klingeln
- permanente Bewegung
- Browser-Neustart
- ESP-Neustart
- leer werdender Akku

---

# 30. Tests

Mindestens:

## Unit Tests

- Eventlogik
- Cooldown
- State Machine
- Backend-API
- MQTT Mapping
- Persistenz

## Integrationstests

- Event -> API -> DB
- Event -> MQTT
- Snapshot -> API -> Dateisystem
- Backend restart -> Daten erhalten
- WebRTC Session Start/Stop

## Hardwaretests

- PIR
- Klingeltaster
- Kamera
- Audio
- Batterie
- Wake/Sleep
- Netzwerk

---

# 31. Messbare Akzeptanzkriterien

Das MVP gilt als erfolgreich, wenn:

1. Klingeltaster zuverlässig erkannt wird.
2. Ein Klingelereignis im Backend ankommt.
3. Das Ereignis an MQTT weitergegeben wird.
4. Das Tablet den Klingelvorgang erkennt.
5. Bewegung einen Snapshot auslösen kann.
6. Der Snapshot persistent gespeichert wird.
7. Die Tablet-Oberfläche Snapshots anzeigen kann.
8. Video vom Türgerät live auf dem Tablet dargestellt wird.
9. Audio vom Türgerät zum Tablet funktioniert.
10. Audio vom Tablet zum Türgerät funktioniert.
11. Eine Live-Session sauber beendet werden kann.
12. Das Türgerät anschließend wieder in den vorgesehenen Energiesparmodus zurückkehrt.
13. Ein Server-Neustart keine gespeicherten Bilder oder Events löscht.
14. Netzwerkfehler nicht zu dauerhaft hohem Stromverbrauch führen.
15. Das Gesamtsystem über dokumentierte Befehle reproduzierbar gebaut und gestartet werden kann.

Zusätzlich messen und dokumentieren:

- Klingel-zu-Anzeige-Latenz
- WebRTC-Verbindungsaufbauzeit
- Video-Latenz
- Audio-Latenz
- Wakeup-Zeit
- Snapshot-Zeit
- Upload-Zeit
- Energiebedarf je Betriebszustand

---

# 32. Nicht Teil des ersten MVP

Noch nicht implementieren, außer es wird für die Architektur benötigt:

- elektrische Hardwareentwicklung
- Türöffner
- Gesichtserkennung
- Cloud-Service
- Internetzugriff von unterwegs
- Multi-House/Multi-Tenant
- langfristige Videoaufzeichnung
- 24/7-Videostream
- separate zusätzliche Klingel-Hardware im Haus

Die Architektur darf Erweiterungen ermöglichen, aber das MVP nicht damit überladen.

---

# 33. Dokumentation

Am Ende müssen vorhanden sein:

```text
README.md
docs/architecture.md
docs/power-budget.md
docs/mqtt.md
docs/api/openapi.yaml

docs/adr/
    ADR-001-webrtc-architecture.md
    ADR-002-mqtt-architecture.md
    ADR-003-client-platform.md
```

Zusätzlich:

- Build-Anleitung Firmware
- Flash-Anleitung
- Docker-Anleitung
- Konfigurationsbeispiele
- Netzwerk-/Portübersicht
- Troubleshooting
- Testanleitung

---

# 34. Vorgehensweise für dich als Entwicklungs-KI

Arbeite iterativ.

Für jede Phase:

1. Anforderungen analysieren.
2. Bestehende offizielle Implementierungen und Dokumentation prüfen.
3. Architekturentscheidung dokumentieren.
4. kleine lauffähige Implementierung erzeugen.
5. Tests ergänzen.
6. Dokumentation aktualisieren.
7. erst danach nächste Phase beginnen.

Bevorzuge vorhandene offizielle Espressif-Komponenten gegenüber selbst erfundenen Protokollimplementierungen.

Bei WebRTC insbesondere aktuelle Espressif-Beispiele untersuchen.

Bei Janus die aktuelle offizielle Janus-Dokumentation verwenden.

Keine Architektur allein deshalb verwerfen, weil sie komplexer erscheint.

Entscheidend sind:

- Funktionsfähigkeit auf ESP32-P4
- Zwei-Wege-Audio
- Video
- geringe Latenz
- Energieeffizienz
- lokale Betreibbarkeit
- Wartbarkeit

---

# 35. Erstes konkretes Arbeitsergebnis

Beginne mit **Phase 0**.

Liefere zunächst:

1. Architekturdiagramm des Gesamtsystems
2. Sequenzdiagramm für „Klingeln“
3. Sequenzdiagramm für „Bewegung“
4. Sequenzdiagramm für „Live-Gespräch“
5. Vergleich Direct WebRTC vs. Espressif Doorbell vs. Janus
6. Vergleich MQTT via Backend vs. Direct MQTT vs. Hybrid
7. Empfehlung für Client: PWA vs. native Android
8. State Machine für die Firmware
9. vorgeschlagenes REST-API
10. vorgeschlagenes MQTT-Schema
11. Docker-Compose-Zielarchitektur
12. Liste der noch benötigten Hardwareparameter

**Danach erst mit der Implementierung beginnen.**