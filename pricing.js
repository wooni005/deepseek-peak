// Pure DeepSeek pricing/business logic.
//
// This module deliberately has no GNOME Shell / GJS imports (no Gio, GLib,
// St, GObject, Soup, Main, ...). It only uses standard ECMAScript and Intl so
// it can be imported unchanged from both the GNOME extension (extension.js)
// and from plain Node.js tests (tests/pricing-test.js).

export const PEAK_PERIODS = [
    {start: 1, end: 4},
    {start: 6, end: 10},
];

// Official Chinese public holidays (State Council, days off), as UTC dates.
// Source: https://github.com/NateScarlet/holiday-cn (based on gov.cn).
// Update this yearly as soon as the calendar for the next year is published.
export const CHINESE_HOLIDAYS = [
    {name: 'New Year', start: '2025-01-01', end: '2025-01-01'},
    {name: 'Spring Festival', start: '2025-01-28', end: '2025-02-04'},
    {name: 'Qingming', start: '2025-04-04', end: '2025-04-06'},
    {name: 'Labour Day', start: '2025-05-01', end: '2025-05-05'},
    {name: 'Dragon Boat', start: '2025-05-31', end: '2025-06-02'},
    {name: 'National Day + Mid-Autumn', start: '2025-10-01', end: '2025-10-08'},
    {name: 'New Year', start: '2026-01-01', end: '2026-01-03'},
    {name: 'Spring Festival', start: '2026-02-15', end: '2026-02-23'},
    {name: 'Qingming', start: '2026-04-04', end: '2026-04-06'},
    {name: 'Labour Day', start: '2026-05-01', end: '2026-05-05'},
    {name: 'Dragon Boat', start: '2026-06-19', end: '2026-06-21'},
    {name: 'Mid-Autumn', start: '2026-09-25', end: '2026-09-27'},
    {name: 'National Day', start: '2026-10-01', end: '2026-10-07'},
];

export function holidayUrl(year) {
    return `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;
}

function utcDateKey(date) {
    return date.toISOString().slice(0, 10);
}

export function findHoliday(now, holidays = CHINESE_HOLIDAYS) {
    const date = utcDateKey(now);

    return holidays.find(h => date >= h.start && date <= h.end) ?? null;
}

export function holidayName(now, holidays = CHINESE_HOLIDAYS) {
    return findHoliday(now, holidays)?.name ?? null;
}

export function findWorkday(now, workdays = []) {
    const date = utcDateKey(now);

    return workdays.find(w => w.date === date) ?? null;
}

export function isWorkday(now, workdays = []) {
    const day = now.getUTCDay();

    // Mon-Fri, or a Chinese compensatory workday in the weekend.
    return (day >= 1 && day <= 5) || findWorkday(now, workdays) !== null;
}

export function isPeak(now, holidays = CHINESE_HOLIDAYS, workdays = []) {
    // A Chinese compensatory workday (调休) is an authoritative, single-day
    // override: it wins over a holiday range, so the normal peak windows apply.
    const compensatory = findWorkday(now, workdays) !== null;

    // Chinese public holidays are otherwise fully off-peak.
    if (!compensatory && holidayName(now, holidays) !== null)
        return false;

    if (!isWorkday(now, workdays))
        return false;

    const hour = now.getUTCHours();

    return PEAK_PERIODS.some(period =>
        hour >= period.start &&
        hour < period.end
    );
}

export function nextTransition(now, holidays = CHINESE_HOLIDAYS, workdays = []) {
    const current = isPeak(now, holidays, workdays);
    const t = new Date(now);

    t.setUTCMinutes(0, 0, 0);
    t.setUTCHours(t.getUTCHours() + 1);

    // All tariff changes fall on whole UTC hours, so scan hour by hour.
    for (let i = 0; i < 24 * 14; i++) {
        if (isPeak(t, holidays, workdays) !== current)
            return t;

        t.setUTCHours(t.getUTCHours() + 1);
    }

    return null;
}

function localDateKey(date, timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

// The popup must always be readable in English, independent of the system
// locale (the panel label keeps using the system locale on purpose).
const MENU_LOCALE = 'en-GB';

export function formatWhen(date, now, timeZone) {
    const time = date.toLocaleTimeString(MENU_LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    });

    if (localDateKey(date, timeZone) === localDateKey(now, timeZone))
        return time;

    const day = date.toLocaleDateString(MENU_LOCALE, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone,
    });

    return `${day} ${time}`;
}

export function formatLocalHour(utcHour, now = new Date(), timeZone) {
    const date = new Date(now);

    date.setUTCHours(utcHour, 0, 0, 0);

    return date.toLocaleTimeString(MENU_LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    });
}

export function formatHolidayEnd(end, timeZone = 'UTC') {
    const date = new Date(`${end}T00:00:00Z`);

    return date.toLocaleDateString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone,
    });
}

export function lastHolidayEnd(holidays = CHINESE_HOLIDAYS) {
    return holidays.reduce(
        (max, h) => (h.end > max ? h.end : max),
        ''
    );
}

export function isStale(now, holidays = CHINESE_HOLIDAYS) {
    const last = lastHolidayEnd(holidays);

    return last !== '' && utcDateKey(now) > last;
}

export function mergeHolidays(base, extra) {
    const seen = new Set(base.map(h => h.start));

    return [...base, ...extra.filter(h => !seen.has(h.start))];
}

export function mergeWorkdays(base, extra) {
    const seen = new Set(base.map(w => w.date));

    return [...base, ...extra.filter(w => !seen.has(w.date))];
}

// Parses a holiday-cn yearly file. Returns both the days off (isOffDay true)
// and the Chinese compensatory workdays (isOffDay false, e.g. a weekend day
// that becomes a workday).
export function parseCalendar(data) {
    const days = Array.isArray(data?.days) ? data.days : [];

    const holidays = days
        .filter(day => day.isOffDay)
        .map(day => ({
            name: day.name,
            start: day.date,
            end: day.date,
        }));

    const workdays = days
        .filter(day => !day.isOffDay)
        .map(day => ({
            name: day.name,
            date: day.date,
        }));

    return {holidays, workdays};
}

// Determines the full current status in one call: peak/off-peak, the active
// holiday, a possible compensatory workday, whether the holiday list is stale,
// and when the next price transition is.
export function getStatus(now = new Date(), holidays = CHINESE_HOLIDAYS, workdays = []) {
    const workday = findWorkday(now, workdays);
    // A compensatory workday overrides a holiday range, so a holiday only
    // applies when no compensatory workday is active.
    const holiday = workday ? null : findHoliday(now, holidays);

    return {
        peak: isPeak(now, holidays, workdays),
        holiday,
        holidayName: holiday?.name ?? null,
        workday,
        workdayName: workday?.name ?? null,
        stale: isStale(now, holidays),
        nextTransition: nextTransition(now, holidays, workdays),
    };
}

// Builds the full popup menu as a plain data model. This is the single source
// for the menu contents: extension.js renders it into PopupMenu items and
// scripts/status.js prints exactly the same lines.
//
// Each entry is:
//   {kind: 'item', text, style?}        -> non-interactive text item
//   {kind: 'action', action, text}      -> action (e.g. 'refresh')
//   {kind: 'separator'}                 -> separator line
//
// `style` is an optional space-separated list of CSS classes that extension.js
// applies to the item label (e.g. 'deepseek-status deepseek-peak' or
// 'deepseek-line'); scripts/status.js and the tests ignore it.
export function buildMenuModel(now = new Date(), holidays = CHINESE_HOLIDAYS, workdays = []) {
    const peak = isPeak(now, holidays, workdays);
    const workday = findWorkday(now, workdays);
    // A compensatory workday overrides a holiday range, so a holiday only
    // shows up (and only blocks peak hours) when no compensatory workday is
    // active.
    const holiday = workday ? null : findHoliday(now, holidays);
    const stale = isStale(now, holidays);
    const next = nextTransition(now, holidays, workdays);

    // Panel shows a status dot plus the time of the next price transition,
    // e.g. "🔴 06:00" (peak now, off-peak at 06:00) or "🟢 do 01:00".
    let panelLabel = peak ? '🔴' : '🟢';

    if (next) {
        const time = next.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
        const sameDay =
            localDateKey(next, undefined) === localDateKey(now, undefined);
        const weekday = sameDay
            ? ''
            : `${next.toLocaleDateString([], {weekday: 'short'})} `;

        panelLabel = `${panelLabel} ${weekday}${time}`;
    }

    // Peak windows apply on a Chinese workday (Mon-Fri or a compensatory
    // workday) and not on a public holiday. A compensatory workday overrides a
    // holiday range, so a holiday only blocks peak hours when no compensatory
    // workday is active. The windows are shown for the whole day, even when
    // both have already ended.
    const peakEligible = !holiday && isWorkday(now, workdays);
    const windows = PEAK_PERIODS.map(
        p => `${formatLocalHour(p.start, now)}–${formatLocalHour(p.end, now)}`
    ).join(' · ');

    const items = [
        {
            kind: 'item',
            role: 'status',
            text: peak
                ? '🔴 DeepSeek API: peak pricing'
                : '🟢 DeepSeek API: off-peak pricing',
            style: peak
                ? 'deepseek-status deepseek-peak'
                : 'deepseek-status deepseek-offpeak',
        },
    ];

    // Holiday / compensatory-workday context lines sit above the peak-hours
    // line, so the reason for "No peak hours today" is clear. A compensatory
    // workday overrides a holiday, so `holiday` is already null on such a day
    // (see above) and only the workday line is shown.
    if (holiday) {
        items.push({
            kind: 'item',
            role: 'holiday',
            text: `🎉 Chinese holiday: ${holiday.name}`,
            style: 'deepseek-line',
        });
    }

    if (workday) {
        items.push({
            kind: 'item',
            role: 'workday',
            text: '🇨🇳 Chinese compensatory workday',
            style: 'deepseek-line',
        });
    }

    items.push({
        kind: 'item',
        role: 'peakHours',
        text: peakEligible
            ? `Peak hours today: ${windows}`
            : 'No peak hours today',
        style: 'deepseek-dim',
    });

    if (!next) {
        items.push({
            kind: 'item',
            role: 'info',
            text: 'ℹ️ No price change in the next 14 days',
            style: 'deepseek-line',
        });
    } else if (peak) {
        items.push({
            kind: 'item',
            role: 'next',
            caption: 'Off-peak from',
            value: formatWhen(next, now),
            text: `Off-peak from ${formatWhen(next, now)}`,
            style: 'deepseek-line',
        });
    } else {
        const period = PEAK_PERIODS.find(p => p.start === next.getUTCHours());
        const value = period
            ? `${formatWhen(next, now)}–${formatLocalHour(period.end, next)}`
            : formatWhen(next, now);

        items.push({
            kind: 'item',
            role: 'next',
            caption: 'Next peak',
            value,
            text: `Next peak: ${value}`,
            style: 'deepseek-line',
        });
    }

    if (stale) {
        items.push({
            kind: 'item',
            role: 'stale',
            text: '⚠️ Holiday list may be out of date',
            style: 'deepseek-line',
        });
        items.push({
            kind: 'action',
            action: 'refresh',
            text: 'Refresh holidays',
        });
    }

    return {peak, holiday, workday, stale, next, panelLabel, items};
}
