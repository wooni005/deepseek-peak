# DeepSeek Peak Pricing

GNOME Shell extension that shows whether the DeepSeek API currently uses
**peak pricing** or **off-peak pricing**. The pricing rules live in a separate,
GNOME-independent module (`pricing.js`) and the downloaded Chinese holiday
calendar is managed by another (`holidays.js`), so the business logic can be
tested with plain Node.js without restarting the shell.

- **Extension UUID:** `deepseek-peak@wooni005.github.com`
- **GNOME Shell:** 50
- **Development tools:** Node.js (for the tests and the status script)

## Features

- Panel indicator with a status dot and the time of the next price transition
  (e.g. `🔴 06:00`, or `🟢 Thu 01:00` when the transition is on another day).
- Popup menu with:
  - the current status (green for off-peak, red for peak);
  - today's Chinese holiday, if any;
  - one compact line with today's peak hours in local time, or
    `No peak hours today` on weekends and holidays;
  - the next peak (or the start of the next off-peak period);
  - an out-of-date warning and a **Refresh holidays** button when the list has
    expired.
- The popup is always in English, independent of the system locale; only the
  panel indicator keeps using the system locale.
- Automatic fetching of the Chinese holiday calendar over HTTP, with a validated
  local cache and a warning when the current year's data is missing.
- Notifications for a missing list and after an update.

## Pricing rules

Peak pricing applies **Monday through Friday**, excluding Chinese public
holidays, in these UTC windows:

| Window | UTC |
| --- | --- |
| Morning | 01:00-04:00 |
| Morning | 06:00-10:00 |

- Outside these windows: **off-peak**.
- Weekend (Saturday and Sunday): **off-peak**, always.
- Chinese holiday: **off-peak**, regardless of the window.

This matches DeepSeek's published rule: *"Peak hours are 01:00 - 04:00 and
06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All
other hours are off-peak, including weekends and Chinese public holidays in
full."* Chinese compensatory workdays (调休, weekend days that become working
days on the official calendar) therefore have **no** special meaning: weekends
stay off-peak.

The UTC times are converted to the computer's local time in the menu.

## Structure

```text
deepseek-peak/
├── extension.js          # GNOME Shell UI: panel, popup, timer, notifications, cache and HTTP I/O
├── pricing.js            # Pure pricing/date logic (no GNOME imports)
├── holidays.js           # Pure downloaded-calendar management: URL, validation, cache, refresh plan
├── gio-async.js          # Asynchronous Gio file helpers (Promises, atomic writes)
├── metadata.json         # Extension metadata (UUID, shell version)
├── stylesheet.css        # Styling
├── README.md
├── tests/
│   ├── pricing-test.js   # Node.js tests for pricing.js
│   ├── holidays-test.js  # Node.js tests for holidays.js
│   └── fixtures/
│       └── holidays.json # Representative calendar used by the tests and dev tools
└── scripts/
    ├── deploy.sh         # Local install: copies the extension into ~/.local/share/gnome-shell/extensions
    ├── package.sh        # Builds an upload-ready zip for extensions.gnome.org in dist/
    ├── scenarios.js      # Dev CLI: renders the popup for many day layouts at once
    └── status.js         # Dev CLI: prints the current popup contents without restarting the shell
```

`extension.js` is responsible for everything GNOME-specific; all calculations
come from `pricing.js` and all calendar-data handling from `holidays.js`. There
are **no** GNOME imports (`Gio`, `GLib`, `St`, `GObject`, `Soup`, `Main`, ...) in
`pricing.js` or `holidays.js`.

## Installation

```bash
./scripts/deploy.sh
```

The script temporarily disables the extension, copies `extension.js`,
`pricing.js`, `holidays.js`, `gio-async.js`, `metadata.json` and
`stylesheet.css` to `~/.local/share/gnome-shell/extensions/<uuid>/` (the UUID is
read from `metadata.json`), and then enables the extension again.

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
`pricing.js`, `holidays.js`, `gio-async.js`, `metadata.json`,
`stylesheet.css`); the tests, scripts and README are left out.

The script reads the UUID and version from `metadata.json`, uses
`gnome-extensions pack` when available (falling back to `zip`), and verifies
that `metadata.json`, `extension.js`, `pricing.js`, `holidays.js` and
`gio-async.js` are present at the archive root. The `dist/` directory is a build artifact and is
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
node tests/holidays-test.js
```

- Use plain Node.js ES modules, the checked-in fixture
  (`tests/fixtures/holidays.json`) and explicit dates, so they are reproducible.
- Exit code `0` if everything passes, `1` on a failure.
- `pricing-test.js` covers the peak windows, weekend, holidays, transitions
  exactly at `04:00`/`06:00`/`10:00` UTC, transitions across midnight, the local
  time for `Europe/Prague` (summer and winter time), the current-year staleness
  rule and December/January boundaries.
- `holidays-test.js` covers payload validation, the empty future-year case, the
  cache round-trip and legacy cache, the China-time November switch, the 24-hour
  refresh throttle and the state transitions that preserve valid cached data.

### Viewing the current status without restarting the shell

`scripts/status.js` prints exactly the same popup contents as the extension,
because both use the same `buildMenuModel()` function:

```bash
node scripts/status.js                       # now
node scripts/status.js 2026-10-14T02:00:00Z  # specific moment (ISO)
```

The script reads the cache that the extension writes, so you see the fetched
holidays. Without a cache the calendar is empty, so the plain Mon-Fri / weekend
rules apply. You can override the cache location with the `DEEPSEEK_PEAK_CACHE`
environment variable.

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
Friday evening whose next peak is on Monday, an out-of-date holiday list with
the **Refresh holidays** button, and a synthetic long holiday with no price
change in sight.

The scenarios deliberately use the checked-in test fixture
(`tests/fixtures/holidays.json`, not the on-disk cache), so every run shows
exactly the same layouts. Peak windows are shown in local time, so pin `TZ` for
reproducible output.

### Architecture

- **`pricing.js`** is pure and imports only standard ECMAScript and `Intl`. It
  is the single source for both the pricing calculation and the menu contents.
- **`holidays.js`** is pure and owns the downloaded calendar: source URL, payload
  validation, the cache schema and the per-year refresh planning.
- **`extension.js`** renders the model from `buildMenuModel()` into real
  `PopupMenu` items and handles the GNOME UI, timer, notifications, cache and
  HTTP.
- **`gio-async.js`** provides Promise wrappers around the asynchronous Gio file
  APIs used for the cache (including an atomic temp-file-plus-rename write), so
  no synchronous file IO runs in the shell.
- **`scripts/status.js`** prints the same model to the console.

This avoids duplicated logic: a change in the presentation or calculation
immediately affects both the menu and the dev CLI.

## Holidays and cache

- The downloaded calendar is the **single source of truth**: the extension ships
  no hardcoded holiday table. The data comes from
  [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) (based on
  gov.cn) at
  `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/<year>.json`.
- Each yearly file's `days` are validated, but only the public holidays
  (`isOffDay: true`) are kept. Compensatory workdays (`isOffDay: false`) are
  ignored because DeepSeek prices weekends as off-peak regardless.
- Results are cached in:

  ```text
  $XDG_DATA_HOME/deepseek-peak/holidays.json
  ```

  (usually `~/.local/share/deepseek-peak/holidays.json`). The cache (schema
  version 3) keeps the `holidays` array and a `years` block with the last refresh
  time and confirmation flag per year. Older caches that still contain a
  `workdays` array are read without error; those entries are simply ignored.
  Writes are atomic (temporary file plus rename).
- Startup loads the cache immediately and refreshes it asynchronously; a year is
  checked at most once every 24 hours. On first install the current year is
  fetched right away.
- From **November 1** the next year is fetched too, so January is ready in time.
  An empty `days` array (the calendar has not been announced yet) is not treated
  as data and is retried on the next daily check without an error notification.
- If the current year has no valid data, the menu shows
  `Holiday list may be out of date` with the option `Refresh holidays`. A
  missing next-year calendar never triggers the warning.

## `pricing.js` API

| Function | Purpose |
| --- | --- |
| `isPeak(now, holidays)` | Current status: peak or off-peak. |
| `nextTransition(now, holidays)` | Next price transition (or `null`). |
| `findHoliday(now, holidays)` / `holidayName(...)` | Active Chinese holiday. |
| `isWorkday(now)` | Mon-Fri check (weekends are always off-peak). |
| `mergeHolidays(base, extra)` | Deduplicating merge. |
| `lastHolidayEnd(holidays)` / `isStale(now, holidays)` | Current-year data check. |
| `chinaDateKey(date)` / `chinaYear(date)` / `chinaMonth(date)` | China-time (UTC+8) helpers. |
| `formatWhen(date, now, timeZone?)` | Date/time for the menu (relative to today). |
| `formatLocalHour(utcHour, now, timeZone?)` | UTC hour to local time. |
| `formatHolidayEnd(end, timeZone?)` | Format a holiday end date. |
| `getStatus(now, holidays)` | Bundles peak/holiday/stale/next. |
| `buildMenuModel(now, holidays, options?)` | Full popup contents as a data model. |
| `PEAK_PERIODS` | Peak-window constants. |

All functions accept an optional `holidays` list; without it an empty list is
used, so the plain Mon-Fri / weekend rules apply.

## `holidays.js` API

| Function | Purpose |
| --- | --- |
| `holidayUrl(year)` | Source URL for a yearly calendar. |
| `parseCalendar(data, requestedYear)` | Validates a holiday-cn file into `{valid, usable, dayCount, holidays}`. |
| `serializeCache(state)` / `parseCache(text)` | Atomic-cache (de)serialization; `parseCache` also accepts legacy caches. |
| `recordSuccess(state, year, parsed, nowMs?)` | Replaces a year's entries and marks it confirmed. |
| `recordAttempt(state, year, nowMs?)` | Keeps cached data, moves the refresh timestamp. |
| `requiredYears(now)` | Current China year, plus next year from November 1. |
| `isRefreshDue(now, cacheState, year)` / `yearsToFetch(now, cacheState, opts?)` | 24-hour refresh throttle. |

## Yearly maintenance

None at the code level: the calendar is fetched, validated and cached
automatically, including the next year from November 1. There is no seed table
to update.

## Requirements

- GNOME Shell 50 for the extension itself.
- Node.js 20.19+ or 22.7+ (or newer) for the tests and dev scripts, because of
  automatic ES module detection for `.js`.
