# DeepSeek Peak Pricing

GNOME Shell-extensie die laat zien of het DeepSeek API-tarief op dit moment
**piektarief** of **daltarief** is. De tariefregels en de Chinese feestdagen-
kalender zitten in een aparte, GNOME-onafhankelijke module (`pricing.js`), zodat
de businesslogica met gewone Node.js getest kan worden zonder de shell te
herstarten.

- **Extensie-UUID:** `deepseek-peak@arjan`
- **GNOME Shell:** 50
- **Ontwikkeltools:** Node.js (voor tests en het status-script)

## Functies

- Paneelindicator met de huidige status (`Piektarief` / `Daltarief`).
- Popup-menu met:
  - de huidige status;
  - de piekvensters (lokaal, alleen op (compensatie)werkdagen);
  - of vandaag een Chinese feestdag of compensatiewerkdag is;
  - de eerstvolgende tariefwisseling;
  - de lokale tijd.
- Automatisch ophalen van de Chinese feestdagenkalender via HTTP, met een lokale
  cache en een waarschuwing wanneer de lijst verouderd is.
- Notificaties bij een verouderde lijst en na een update.

## Tariefregels

Piektarief geldt op **Chinese werkdagen** (ma-vr, plus compensatiewerkdagen) in
deze UTC-vensters:

| Venster | UTC |
| --- | --- |
| Ochtend | 01:00-04:00 |
| Ochtend | 06:00-10:00 |

- Buiten deze vensters: **daltarief**.
- Weekend (geen compensatiewerkdag): **daltarief**.
- Chinese feestdag: **daltarief**, ongeacht het venster.
- Chinese compensatiewerkdag (调休, een weekenddag die werkdag wordt):
  **normale piekvensters gelden**.

De UTC-tijden worden in het menu naar de lokale tijd van de computer omgerekend.

## Structuur

```text
deepseek-peak/
├── extension.js          # GNOME Shell UI: panel, popup, timer, notificaties, cache- en HTTP-IO
├── pricing.js            # Pure tarief-/feestdagenlogica (geen GNOME imports)
├── metadata.json         # Extensie-metadata (UUID, shell-versie)
├── stylesheet.css        # Styling
├── README.md
├── tests/
│   └── pricing-test.js   # Node.js tests voor pricing.js
└── scripts/
    ├── deploy.sh         # Kopieert de extensie naar ~/.local/share/gnome-shell/extensions
    └── status.js         # Dev-CLI: print de huidige popup-inhoud zonder shell-herstart
```

`extension.js` is verantwoordelijk voor alles wat GNOME-specifiek is; alle
berekeningen komen uit `pricing.js`. Er staan **geen** GNOME-imports
(`Gio`, `GLib`, `St`, `GObject`, `Soup`, `Main`, ...) in `pricing.js`.

## Installatie

```bash
./scripts/deploy.sh
```

Het script schakelt de extensie tijdelijk uit, kopieert `extension.js`,
`pricing.js`, `metadata.json` en `stylesheet.css` naar
`~/.local/share/gnome-shell/extensions/deepseek-peak@arjan/` en schakelt de
extensie weer in.

Na de eerste installatie (of na een codewijziging in `extension.js`) moet de
GNOME Shell opnieuw geladen worden:

- **Wayland:** uitloggen en weer inloggen.
- **X11:** `Alt+F2`, typ `r`, Enter.

Daarna inschakelen (indien nodig):

```bash
gnome-extensions enable deepseek-peak@arjan
gnome-extensions info deepseek-peak@arjan
```

## Ontwikkelen

### Tests draaien

```bash
node tests/pricing-test.js
```

- Gebruikt gewone Node.js ES-modules en expliciete datums, dus reproduceerbaar.
- Exitcode `0` als alles slaagt, `1` bij een fout.
- Dekt o.a. de piekvensters, weekend, feestdagen, overgangen exact op
  `04:00`/`06:00`/`10:00` UTC, overgangen over middernacht, compensatiewerkdagen
  en de lokale tijd voor `Europe/Prague` (zomer- en wintertijd).

### Huidige status bekijken zonder de shell te herstarten

`scripts/status.js` print exact dezelfde popup-inhoud als de extensie, omdat
beide dezelfde functie `buildMenuModel()` gebruiken:

```bash
node scripts/status.js                       # nu
node scripts/status.js 2026-10-14T02:00:00Z  # specifiek moment (ISO)
```

Het script leest de cache die de extensie wegschrijft, zodat je de opgehaalde
feestdagen en compensatiedagen ziet. Zonder cache wordt de seed-tabel in
`pricing.js` gebruikt. Een alternatieve cachelocatie opgeven kan met de
omgevingsvariabele `DEEPSEEK_PEAK_CACHE`.

Voorbeelduitvoer:

```text
Panel: 🟢 Daltarief
Moment: 2026-10-07T07:31:26.509Z

Popup-menu:
🟢 DeepSeek API: daltarief
🎉 Chinese feestdag: Nationale feestdag · Vandaag geen piektarief
🔴 Volgende piek do 8 okt 03:00–06:00
────────────────────────────
Lokale tijd: 09:31
```

### Architectuur

- **`pricing.js`** is puur en importeert alleen standaard ECMAScript en `Intl`.
  Het is de enige bron voor de tariefberekening én voor de menu-inhoud.
- **`extension.js`** rendert het model uit `buildMenuModel()` naar echte
  `PopupMenu`-items en regelt de GNOME-UI, timer, notificaties, cache en HTTP.
- **`scripts/status.js`** print hetzelfde model naar de console.

Hierdoor is er geen dubbele logica: een wijziging in de presentatie of
berekening werkt meteen door in zowel het menu als de dev-CLI.

## Feestdagen en cache

- De seed-tabel `CHINESE_HOLIDAYS` in `pricing.js` bevat de officiele Chinese
  publieke feestdagen (bron:
  [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn), gebaseerd
  op gov.cn).
- De extensie haalt jaarlijks de kalender op van
  `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/<jaar>.json`.
- Resultaten worden gecached in:

  ```text
  $XDG_DATA_HOME/deepseek-peak/holidays.json
  ```

  (meestal `~/.local/share/deepseek-peak/holidays.json`), met zowel
  `holidays` als `workdays`.
- Als de laatste feestdag in de lijst voorbij is, toont het menu
  `Feestdagenlijst mogelijk verouderd` met de optie `Feestdagen bijwerken`.

## `pricing.js` API

| Functie | Doel |
| --- | --- |
| `isPeak(now, holidays, workdays)` | Huidige status: piek of dal. |
| `nextTransition(now, holidays, workdays)` | Eerstvolgende tariefwisseling (of `null`). |
| `findHoliday(now, holidays)` / `holidayName(...)` | Actieve Chinese feestdag. |
| `findWorkday(now, workdays)` / `isWorkday(...)` | Compensatiewerkdag / werkdag-check. |
| `parseCalendar(data)` | Parseert een holiday-cn-bestand naar `{holidays, workdays}`. |
| `mergeHolidays(base, extra)` / `mergeWorkdays(base, extra)` | Deduplicerend samenvoegen. |
| `lastHolidayEnd(holidays)` / `isStale(now, holidays)` | Verouderingscheck van de lijst. |
| `formatWhen(date, now, timeZone?)` | Datum/tijd voor het menu (relatief aan vandaag). |
| `formatLocalHour(utcHour, now, timeZone?)` | UTC-uur naar lokale tijd. |
| `formatHolidayEnd(end, timeZone?)` | Feestdageinde formatteren. |
| `getStatus(now, holidays, workdays)` | Bundelt peak/holiday/workday/stale/next. |
| `buildMenuModel(now, holidays, workdays)` | Volledige popup-inhoud als datamodel. |
| `PEAK_PERIODS` / `CHINESE_HOLIDAYS` / `holidayUrl(year)` | Constanten en kalender-URL. |

Alle functies accepteren optionele `holidays`/`workdays`; zonder argument
wordt `CHINESE_HOLIDAYS` respectievelijk een lege lijst gebruikt.

## Jaarlijks onderhoud

De kalender wordt automatisch opgehaald, maar de seed-tabel in `pricing.js`
moet bijgewerkt worden zodra de officiele kalender van een nieuw jaar
verschijnt. Werk dan `CHINESE_HOLIDAYS` bij en draai de tests opnieuw.

## Vereisten

- GNOME Shell 50 voor de extensie zelf.
- Node.js 20.19+ of 22.7+ (nieuwer) voor `tests/pricing-test.js` en
  `scripts/status.js`, vanwege automatische ES-module-detectie voor `.js`.
