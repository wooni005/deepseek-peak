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
    // Chinese public holidays are fully off-peak.
    if (holidayName(now, holidays) !== null)
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

export function formatWhen(date, now, timeZone) {
    const time = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    });

    if (localDateKey(date, timeZone) === localDateKey(now, timeZone))
        return time;

    const day = date.toLocaleDateString([], {
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

    return date.toLocaleTimeString([], {
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
    const holiday = findHoliday(now, holidays);
    const workday = findWorkday(now, workdays);

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
//   {kind: 'item', text}                -> non-interactive text item
//   {kind: 'action', action, text}      -> action (e.g. 'refresh')
//   {kind: 'separator'}                 -> separator line
export function buildMenuModel(now = new Date(), holidays = CHINESE_HOLIDAYS, workdays = []) {
    const peak = isPeak(now, holidays, workdays);
    const holiday = findHoliday(now, holidays);
    const workday = findWorkday(now, workdays);
    const stale = isStale(now, holidays);
    const next = nextTransition(now, holidays, workdays);

    const panelLabel = peak
        ? '🔴 Peak pricing'
        : '🟢 Off-peak pricing';

    const windows = PEAK_PERIODS.map(
        p => `${formatLocalHour(p.start, now)}–${formatLocalHour(p.end, now)}`
    ).join(' · ');

    const items = [
        {
            kind: 'item',
            text: peak
                ? '🔴 DeepSeek API: peak pricing'
                : '🟢 DeepSeek API: off-peak pricing',
        },
    ];

    // The peak-hours block is only relevant on a real (compensatory) workday.
    if (!holiday && isWorkday(now, workdays)) {
        items.push({
            kind: 'item',
            text: '🔴 Peak pricing · Chinese workdays',
        });
        items.push({
            kind: 'item',
            text: windows,
        });
    }

    if (holiday) {
        items.push({
            kind: 'item',
            text: `🎉 Chinese holiday: ${holiday.name} · No peak pricing today`,
        });
    } else if (workday) {
        items.push({
            kind: 'item',
            text: '🇨🇳 Compensatory workday · Normal peak windows apply today',
        });
    }

    if (!next) {
        items.push({
            kind: 'item',
            text: 'ℹ️ No price change in the next 14 days',
        });
    } else if (peak) {
        items.push({
            kind: 'item',
            text: `🟢 Off-peak from ${formatWhen(next, now)}`,
        });
    } else {
        const period = PEAK_PERIODS.find(p => p.start === next.getUTCHours());

        items.push({
            kind: 'item',
            text: period
                ? `🔴 Next peak ${formatWhen(next, now)}–${formatLocalHour(period.end, next)}`
                : `🔴 Next peak ${formatWhen(next, now)}`,
        });
    }

    if (stale) {
        items.push({
            kind: 'item',
            text: '⚠️ Holiday list may be out of date',
        });
        items.push({
            kind: 'action',
            action: 'refresh',
            text: 'Refresh holidays',
        });
    }

    items.push({kind: 'separator'});
    items.push({
        kind: 'item',
        text: `Local time: ${now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        })}`,
    });

    return {peak, holiday, workday, stale, next, panelLabel, items};
}
