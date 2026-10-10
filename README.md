# DeepSeek Peak Pricing

GNOME Shell extension that shows whether the DeepSeek API currently uses
**peak pricing** or **off-peak pricing**. The pricing rules and the Chinese
holiday calendar live in a separate, GNOME-independent module (`pricing.js`),
so the business logic can be tested with plain Node.js without restarting the
shell.

- **Extension UUID:** `deepseek-peak@wooni005.github.com`
- **GNOME Shell:** 50
- **Development tools:** Node.js (for the tests and the status script)

## Features

- Panel indicator with a status dot and the time of the next price transition
  (e.g. `🔴 06:00`, or `🟢 Thu 01:00` when the transition is on another day).
- Popup menu with:
  - the current status (green for off-peak, red for peak);
  - today's Chinese holiday or compensatory workday, if any;
  - one compact line with today's peak hours in local time, or
    `No peak hours today` on weekends and holidays;
  - the next peak (or the start of the next off-peak period);
  - an out-of-date warning and a **Refresh holidays** button when the list has
    expired.
- The popup is always in English, independent of the system locale; only the
  panel indicator keeps using the system locale.
- Automatic fetching of the Chinese holiday calendar over HTTP, with a local
  cache and a warning when the list is out of date.
- Notifications for an outdated list and after an update.

## Pricing rules

Peak pricing applies on **Chinese workdays** (Mon-Fri, plus compensatory
workdays) in these UTC windows:

| Window | UTC |
| --- | --- |
| Morning | 01:00-04:00 |
| Morning | 06:00-10:00 |

- Outside these windows: **off-peak**.
- Weekend (not a compensatory workday): **off-peak**.
- Chinese holiday: **off-peak**, regardless of the window.
- Chinese compensatory workday (调休, a weekend day that becomes a workday):
  **the normal peak windows apply**.

The UTC times are converted to the computer's local time in the menu.

## Structure

```text
deepseek-peak/
├── extension.js          # GNOME Shell UI: panel, popup, timer, notifications, cache and HTTP I/O
├── pricing.js            # Pure pricing/holiday logic (no GNOME imports)
├── gio-async.js          # Asynchronous Gio file helpers (Promises)
├── metadata.json         # Extension metadata (UUID, shell version)
├── stylesheet.css        # Styling
├── README.md
├── tests/
│   └── pricing-test.js   # Node.js tests for pricing.js
└── scripts/
    ├── deploy.sh         # Local install: copies the extension into ~/.local/share/gnome-shell/extensions
    ├── package.sh        # Builds an upload-ready zip for extensions.gnome.org in dist/
    ├── scenarios.js      # Dev CLI: renders the popup for many day layouts at once
    └── status.js         # Dev CLI: prints the current popup contents without restarting the shell
```

`extension.js` is responsible for everything GNOME-specific; all calculations
come from `pricing.js`. There are **no** GNOME imports
(`Gio`, `GLib`, `St`, `GObject`, `Soup`, `Main`, ...) in `pricing.js`.

## Installation

```bash
./scripts/deploy.sh
```

The script temporarily disables the extension, copies `extension.js`,
`pricing.js`, `metadata.json` and `stylesheet.css` to
`~/.local/share/gnome-shell/extensions/<uuid>/` (the UUID is read from
`metadata.json`), and then enables the extension again.

After the first install (or after changing code in `extension.js`), GNOME Shell
must be reloaded:

- **Wayland:** log out and log back in.
- **X11:** `Alt+F2`, type `r`, Enter.

Then enable it if needed:

```bash
gnome-extensions enable deepseek-peak@wooni005.github.com
gnome-extensions info deepseek-peak@wooni005.github.com
```

## Packaging for extensions.gnome.org

```bash
./scripts/package.sh
```

This builds `dist/<uuid>.shell-extension.zip`, ready to upload to
[extensions.gnome.org](https://extensions.gnome.org). The archive contains the
extension files at the **top level** (no containing folder), which is what the
site expects, and includes only the runtime files (`extension.js`,
`pricing.js`, `gio-async.js`, `metadata.json`, `stylesheet.css`); the tests,
scripts and README are left out.

The script reads the UUID and version from `metadata.json`, uses
`gnome-extensions pack` when available (falling back to `zip`), and verifies
that `metadata.json`, `extension.js`, `pricing.js` and `gio-async.js` are
present at the archive root. The `dist/` directory is a build artifact and is
git-ignored.

### Package check with `shexli`

extensions.gnome.org runs `shexli` (a static analyzer for extension reviews) on
uploaded extensions. Run it on the **generated zip**, not on the repository
directory, or it will also scan `.git/`, `tests/` and `scripts/`:

```bash
shexli dist/deepseek-peak@wooni005.github.com.shell-extension.zip
```

`./scripts/package.sh` runs this check automatically when `shexli` is installed
(install it with `pipx install shexli` or `pip install shexli`).

Upload flow: sign in on extensions.gnome.org, click **Upload Extension**, and
select the generated zip.

## Development

### Running the tests

```bash
node tests/pricing-test.js
```

- Uses plain Node.js ES modules and explicit dates, so it is reproducible.
- Exit code `0` if everything passes, `1` on a failure.
- Covers, among other things, the peak windows, weekend, holidays, transitions
  exactly at `04:00`/`06:00`/`10:00` UTC, transitions across midnight,
  compensatory workdays and the local time for `Europe/Prague` (summer and
  winter time).

### Viewing the current status without restarting the shell

`scripts/status.js` prints exactly the same popup contents as the extension,
because both use the same `buildMenuModel()` function:

```bash
node scripts/status.js                       # now
node scripts/status.js 2026-10-14T02:00:00Z  # specific moment (ISO)
```

The script reads the cache that the extension writes, so you see the fetched
holidays and compensatory workdays. Without a cache, the seed table in
`pricing.js` is used. You can override the cache location with the
`DEEPSEEK_PEAK_CACHE` environment variable.

Example output:

```text
Panel: 🟢 Thu 03:00
Moment: 2026-10-07T07:31:26.509Z

Popup menu:
🟢 DeepSeek API: off-peak pricing
🎉 Chinese holiday: National Day
No peak hours today
Next peak: Thu 8 Oct 03:00–06:00
```

The popup is always rendered in English (`en-GB` date/time formatting), so day
and month names stay readable on any system. Only the panel indicator follows
the system locale, e.g. `Panel: 🟢 do 03:00` on a Dutch system.

### Previewing different day layouts without restarting the shell

`scripts/scenarios.js` renders the popup for a set of representative day
layouts at once, using the same `buildMenuModel()` as the extension:

```bash
node scripts/scenarios.js                 # all scenarios
node scripts/scenarios.js weekend         # only matching scenarios
node scripts/scenarios.js --styles        # annotate lines with their CSS classes
TZ=Europe/Prague node scripts/scenarios.js
```

It covers a normal workday (before, during and after peak, and in the gap
between the two windows), a Saturday and Sunday weekend, a Chinese holiday, a
compensatory workday (a weekend that becomes a workday), a holiday that is also
a compensatory workday, a Friday evening whose next peak is on Monday, an
out-of-date holiday list with the **Refresh holidays** button, and a synthetic
long holiday with no price change in sight.

The scenarios deliberately use the seed table in `pricing.js` (not the on-disk
cache), so every run shows exactly the same layouts. Peak windows are shown in
local time, so pin `TZ` for reproducible output.

### Architecture

- **`pricing.js`** is pure and imports only standard ECMAScript and `Intl`. It
  is the single source for both the pricing calculation and the menu contents.
- **`extension.js`** renders the model from `buildMenuModel()` into real
  `PopupMenu` items and handles the GNOME UI, timer, notifications, cache and
  HTTP.
- **`gio-async.js`** provides Promise wrappers around the asynchronous Gio file
  APIs used for the cache (so no synchronous file IO runs in the shell).
- **`scripts/status.js`** prints the same model to the console.

This avoids duplicated logic: a change in the presentation or calculation
immediately affects both the menu and the dev CLI.

## Holidays and cache

- The seed table `CHINESE_HOLIDAYS` in `pricing.js` contains the official
  Chinese public holidays (source:
  [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn), based
  on gov.cn).
- The extension fetches the yearly calendar from
  `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/<year>.json`.
- Results are cached in:

  ```text
  $XDG_DATA_HOME/deepseek-peak/holidays.json
  ```

  (usually `~/.local/share/deepseek-peak/holidays.json`), with both
  `holidays` and `workdays`.
- If the last holiday in the list has passed, the menu shows
  `Holiday list may be out of date` with the option `Refresh holidays`.

## `pricing.js` API

| Function | Purpose |
| --- | --- |
| `isPeak(now, holidays, workdays)` | Current status: peak or off-peak. |
| `nextTransition(now, holidays, workdays)` | Next price transition (or `null`). |
| `findHoliday(now, holidays)` / `holidayName(...)` | Active Chinese holiday. |
| `findWorkday(now, workdays)` / `isWorkday(...)` | Compensatory workday / workday check. |
| `parseCalendar(data)` | Parses a holiday-cn file into `{holidays, workdays}`. |
| `mergeHolidays(base, extra)` / `mergeWorkdays(base, extra)` | Deduplicating merge. |
| `lastHolidayEnd(holidays)` / `isStale(now, holidays)` | Staleness check for the list. |
| `formatWhen(date, now, timeZone?)` | Date/time for the menu (relative to today). |
| `formatLocalHour(utcHour, now, timeZone?)` | UTC hour to local time. |
| `formatHolidayEnd(end, timeZone?)` | Format a holiday end date. |
| `getStatus(now, holidays, workdays)` | Bundles peak/holiday/workday/stale/next. |
| `buildMenuModel(now, holidays, workdays)` | Full popup contents as a data model. |
| `PEAK_PERIODS` / `CHINESE_HOLIDAYS` / `holidayUrl(year)` | Constants and calendar URL. |

All functions accept optional `holidays`/`workdays`; without arguments,
`CHINESE_HOLIDAYS` and an empty list are used respectively.

## Yearly maintenance

The calendar is fetched automatically, but the seed table in `pricing.js` must
be updated as soon as the official calendar for a new year is published. Update
`CHINESE_HOLIDAYS` and run the tests again.

## Requirements

- GNOME Shell 50 for the extension itself.
- Node.js 20.19+ or 22.7+ (or newer) for `tests/pricing-test.js` and
  `scripts/status.js`, because of automatic ES module detection for `.js`.
