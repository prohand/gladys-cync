# Cync

Diese Integration verbindet Gladys mit deinem **Cync**-Konto (früher **C by
GE**, GE Lighting): Lampen, LED-Streifen, Einbaustrahler, Wandschalter und
Dimmer, smarte Steckdosen und der Ventilator-Controller, die du in der
Cync-App eingerichtet hast.

## Bevor du beginnst

- Deine Geräte werden in der **Cync-App** eingerichtet, nicht in Gladys. Prüfe
  zuerst, dass sie dort funktionieren.
- Jedes Zuhause braucht **mindestens ein Cync-Gerät mit WLAN**, das immer mit
  Strom versorgt ist: eine WLAN-Lampe, eine Steckdose, ein Schalter. Lampen nur
  mit Bluetooth werden darüber erreicht.
- Gladys braucht Internetzugang: Cync-Geräte werden **über die Cync-Cloud**
  gesteuert (siehe [Nur Cloud](#nur-cloud)).

## Konfiguration

| Feld                                     | Was einzutragen ist                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **E-Mail des Cync-Kontos**               | Die E-Mail-Adresse, mit der du dich in der Cync-App anmeldest.                                                  |
| **Passwort des Cync-Kontos**             | Das zugehörige Passwort. Von Gladys als Geheimnis gespeichert, nie in die Logs geschrieben.                     |
| **Cync-Räume als Lampen hinzufügen**     | Standardmäßig an: Jeder Raum der Cync-App wird in Gladys auch zu einer Lampe (siehe unten).                     |
| **Vollständiges Lesen der Zustände (s)** | Standardmäßig 300. Änderungen kommen ohnehin sofort an; dieses Lesen erkennt Geräte, die offline gegangen sind. |
| **Ausführliche Logs**                    | Standardmäßig aus. Nur zur Untersuchung eines Geräts einschalten: Jeder Frame wird protokolliert.               |

## Anmeldung: der Bestätigungscode

Cync schützt das Konto meist mit einem per E-Mail gesendeten Code. Die
Anmeldung braucht drei Klicks, einmalig:

1. Gib E-Mail und Passwort ein und klicke auf **Speichern**. Der Status zeigt,
   dass ein Code nötig ist.
2. Klicke auf **Bestätigungscode senden**. Cync schickt einen Code an die
   Adresse des Kontos.
3. Klicke auf **Code bestätigen**, gib den Code ein und bestätige.

Die Antwort nennt die Anzahl der gefundenen Geräte, und der Status wechselt
auf **verbunden**. Die Integration bewahrt ihre Sitzung danach in ihrem eigenen
Speicher auf: Ein Neustart von Gladys oder der Integration verlangt **keinen**
neuen Code.

Ein neuer Code ist nur nötig, wenn du die E-Mail-Adresse änderst oder Cync die
Sitzung beendet (zum Beispiel nach einer Passwortänderung). Der Status zeigt
es an.

## Geräte

Öffne nach der Anmeldung den Tab **Erkennung** der Integration und füge die
gewünschten Geräte hinzu.

| Cync-Gerät                          | In Gladys                                               |
| ----------------------------------- | ------------------------------------------------------- |
| Lampe, Streifen, Einbaustrahler     | Lampe: an/aus, Helligkeit, Weiß, Farbe — je nach Modell |
| Wandschalter / Dimmer               | Lampe: an/aus (und Helligkeit bei einem Dimmer)         |
| Schalter mit Bewegungsmelder        | Lampe, dazu ein **Bewegungssensor**                     |
| Steckdose, Außensteckdose (doppelt) | Schalter (ein Gerät pro Steckdose)                      |
| Ventilator-Controller               | Schalter: an/aus und Geschwindigkeit (0–100 %)          |
| Raum oder Gruppe der Cync-App       | Lampe: steuert alle ihre Lampen auf einmal              |

Die **Weißtemperatur** reicht von 2000 K (warm) bis 7000 K (kalt).

Kameras, Thermostate und andere Cync-Produkte werden nicht unterstützt: Sie
werden ausgelassen, und die Logs nennen sie.

### Räume

Ein Raum schaltet alle seine Lampen **mit einem Befehl**: Sie gehen zusammen
an, statt nacheinander. Ein Raum bietet nur, was **alle** seine Lampen können:
Ein Raum mit Farb- und Weißlampen hat keine Farbeinstellung. Er wird als an
angezeigt, sobald mindestens eine seiner Lampen an ist.

Ein Raum ohne Lampe (nur Steckdosen) wird nicht hinzugefügt. Schalte **Cync-Räume
als Lampen hinzufügen** aus, wenn du gar keine Räume willst.

### Das Verbindungs-Abzeichen

Jedes Cync-Gerät zeigt ein **Cloud**-Abzeichen, solange die Cync-Cloud es
erreicht, und **nicht erreichbar**, wenn nicht: Das Gerät hat keinen Strom,
ist außer Reichweite der anderen Geräte, oder die Integration hat die Cloud
verloren.

## Aktionen

Auf der Seite der Integration:

- **Bestätigungscode senden** / **Code bestätigen**: die Anmeldung oben.
- **Verbindung testen**: liest sofort alle Zustände und nennt die Anzahl der
  Geräte online sowie der Zuhause mit WLAN-Relais.
- **Geräteliste neu laden**: liest die Zuhause erneut aus der Cync-Cloud, nachdem
  in der Cync-App ein Gerät hinzugefügt, umbenannt oder verschoben wurde.

## Szenen und Dashboard (Gladys 5.1+)

### Szenen-Auslöser

- **Ein Cync-Sensor erkennt Bewegung**: wird einmal pro Erkennung eines
  Schalters oder Sensors mit Bewegungsmelder ausgelöst. Filtere auf den Sensor
  oder lass das Feld leer für alle.
- **Ein Cync-Gerät geht offline oder online**: Das Cync-Netz hört ein Gerät
  nicht mehr (Stromausfall, Wandschalter aus) oder hört es wieder. Filtere auf
  das Gerät und die Änderung; die folgenden Aktionen lesen die Änderung in der
  Variablen `status` (`online` oder `offline`).

### Szenen-Aktionen

- **Eine Cync-Lampe in einem Schritt einstellen**: Ein, Helligkeit und
  Weißtemperatur in **einem** Befehl. Eine so eingeschaltete Lampe geht direkt
  auf den Zielwert, ohne zuerst mit der alten Einstellung aufzublitzen.
  Funktioniert auch für Räume. Ihre Ausgabe **Befehl gesendet** ist falsch,
  wenn die Lampe nicht erreicht werden konnte: Nutze sie als Bedingung, wenn
  der Rest der Szene davon abhängt.
- **Cync-Zustände jetzt lesen**: fragt jedes Zuhause nach dem Zustand seiner
  Geräte. Ausgaben: **Geräte online** und **Geräte insgesamt**.

### Widgets

- **Cync-Status**: die Cloud-Verbindung, die Geräte online, das WLAN-Relais
  jedes Zuhauses und zwei Schaltflächen: **Zustände lesen** und **Neu laden**.
- **Cync-Geräte**: eine Zeile pro Gerät: an (mit Helligkeit), aus oder offline.
  Die Einstellung **Anzeigen** beschränkt sie auf eingeschaltete Geräte oder
  auf die offline — praktisch nach einem Stromausfall.

## Gut zu wissen

### Nur Cloud

Cync-Geräte haben keine lokale API: Die Cync-App selbst steuert sie über die
Cync-Cloud. Die Integration macht es genauso, über eine dauerhafte Verbindung:

- deine Befehle gehen an die Cloud, die sie an ein **WLAN-Gerät deines
  Zuhauses** (das „Relais“) übergibt, das sie per Bluetooth an die anderen
  Geräte weiterreicht;
- jede Änderung — aus Gladys, der Cync-App, von einem Wandschalter oder einem
  Sprachassistenten — kommt auf demselben Weg zurück, in unter einer Sekunde.

Ohne Internet oder bei einem Ausfall der Cync-Cloud kann Gladys die Geräte
daher nicht mehr steuern. Die Integration verbindet sich so bald wie möglich
von selbst neu.

### Das Zertifikat des Cync-Servers

Der Cync-Server zeigt ein abgelaufenes Zertifikat, dessen Name nicht passt.
Die Integration versucht zuerst eine strenge Prüfung; schlägt sie fehl,
verbindet sie sich trotzdem, wie die Cync-App, und schreibt eine Warnung in
die Logs. Der Datenverkehr bleibt verschlüsselt.

### Was gespeichert wird

Die Integration bewahrt ihre Cync-Sitzung (Tokens, nicht das Passwort) in
ihrem eigenen Speicher auf, den nur sie lesen kann. Das Passwort bleibt in der
Konfiguration von Gladys.

## Fehlerbehebung

| Symptom                                          | Was zu prüfen ist                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Immer wieder „Code nötig“                        | Nutze **Bestätigungscode senden** und dann **Code bestätigen** mit dem neuesten Code: Ein Code läuft schnell ab.                  |
| „Die Cync-Cloud hat diesen Code abgelehnt“       | Falscher oder abgelaufener Code oder falsches Passwort: Prüfe das Passwort, fordere einen neuen Code an.                          |
| Alle Geräte eines Zuhauses sind nicht erreichbar | Kein WLAN-fähiges Cync-Gerät dieses Zuhauses ist online. Schalte eines ein; **Verbindung testen** zeigt die Zuhause ohne Relais.  |
| Ein Gerät ist nicht erreichbar                   | Es hat keinen Strom (Wandschalter aus?) oder ist zu weit von den anderen entfernt. Die Cync-App zeigt dasselbe.                   |
| Ein neues Gerät erscheint nicht                  | **Geräteliste neu laden**, dann der Tab **Erkennung**.                                                                            |
| Ein Gerät reagiert nicht, die anderen schon      | Schalte **Ausführliche Logs** ein, versuche es erneut und sieh dir die Logs der Integration an (gesendete und empfangene Frames). |
