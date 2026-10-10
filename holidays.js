// Pure holiday-data management for the DeepSeek Peak extension.
//
// This module owns everything about the downloaded Chinese calendar: the source
// URL, validation of the HTTP payload, the on-disk cache schema, and the logic
// that decides which years must be (re)fetched. Like pricing.js it imports no
// GNOME Shell / GJS modules, so it can be used unchanged from extension.js and
// from plain Node.js tests.
//
// The downloaded calendar is the single source of truth: there is no hardcoded
// fallback table anywhere in the extension.

import {
    chinaMonth,
    chinaYear,
    mergeHolidays,
    mergeWorkdays,
    yearOf,
} from './pricing.js';

// Check a year for updates at most once a day.
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Cache schema version. Version 2 adds the per-year `years` metadata block on
// top of the version 1 `holidays`/`workdays` arrays.
export const CACHE_VERSION = 2;

export function holidayUrl(year) {
    return `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A strict `YYYY-MM-DD` check that also rejects impossible dates such as
// 2026-02-30 (the Date round-trip would shift them to another day).
function isValidDateKey(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value))
        return false;

    const date = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
}

function invalidCalendar() {
    return {valid: false, usable: false, dayCount: 0, holidays: [], workdays: []};
}

// Parses and validates one holiday-cn yearly file.
//
// `requestedYear` is the year the file is expected to describe. When it is
// given, a present `data.year` field must match it and every date must belong
// to it. The result always has the same shape:
//   {valid, usable, dayCount, holidays, workdays}
// `valid` is true when the structure passed validation. `usable` is true only
// when the structure is valid *and* at least one day was returned, so an empty
// `days` array (a future year that has not been announced yet) is never treated
// as confirmed holiday data.
export function parseCalendar(data, requestedYear) {
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return invalidCalendar();

    const hasRequestedYear = requestedYear !== undefined && requestedYear !== null;

    if (hasRequestedYear && data.year !== undefined) {
        const year = Number(data.year);

        if (!Number.isInteger(year) || year !== Number(requestedYear))
            return invalidCalendar();
    }

    if (!Array.isArray(data.days))
        return invalidCalendar();

    const holidays = [];
    const workdays = [];

    for (const day of data.days) {
        if (day === null || typeof day !== 'object' || Array.isArray(day))
            return invalidCalendar();

        if (!isValidDateKey(day.date))
            return invalidCalendar();

        if (typeof day.isOffDay !== 'boolean')
            return invalidCalendar();

        if (hasRequestedYear && yearOf(day.date) !== Number(requestedYear))
            return invalidCalendar();

        const name = typeof day.name === 'string' ? day.name : '';

        if (day.isOffDay)
            holidays.push({name, start: day.date, end: day.date});
        else
            workdays.push({name, date: day.date});
    }

    return {
        valid: true,
        usable: data.days.length > 0,
        dayCount: data.days.length,
        holidays,
        workdays,
    };
}

// --- cache (de)serialization -------------------------------------------------

function sanitizeHoliday(entry) {
    if (entry === null || typeof entry !== 'object')
        return null;

    if (!isValidDateKey(entry.start) || !isValidDateKey(entry.end))
        return null;

    if (entry.start > entry.end)
        return null;

    return {
        name: typeof entry.name === 'string' ? entry.name : '',
        start: entry.start,
        end: entry.end,
    };
}

function sanitizeWorkday(entry) {
    if (entry === null || typeof entry !== 'object')
        return null;

    if (!isValidDateKey(entry.date))
        return null;

    return {
        name: typeof entry.name === 'string' ? entry.name : '',
        date: entry.date,
    };
}

function sanitizeList(list, sanitize) {
    if (!Array.isArray(list))
        return [];

    const seen = new Set();
    const out = [];

    for (const entry of list) {
        const clean = sanitize(entry);

        if (!clean)
            continue;

        const key = clean.start ?? clean.date;

        if (seen.has(key))
            continue;

        seen.add(key);
        out.push(clean);
    }

    return out;
}

export function serializeCache(state) {
    const source = state?.years ?? {};
    const years = {};

    for (const year of Object.keys(source).sort()) {
        const meta = source[year];

        years[year] = {
            updatedAt: Number(meta?.updatedAt) || 0,
            confirmed: Boolean(meta?.confirmed),
        };
    }

    return JSON.stringify({
        version: CACHE_VERSION,
        holidays: state?.holidays ?? [],
        workdays: state?.workdays ?? [],
        years,
    }, null, 2);
}

// Parses the on-disk cache. Returns null for malformed JSON or a non-object
// payload. Individual invalid entries are dropped rather than failing the whole
// cache. A legacy cache without `years` metadata is accepted: its years are
// derived from the stored data and marked for an immediate background refresh.
export function parseCache(text) {
    let data;

    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return null;

    const holidays = sanitizeList(data.holidays, sanitizeHoliday);
    const workdays = sanitizeList(data.workdays, sanitizeWorkday);
    const years = {};

    if (data.years !== null && typeof data.years === 'object' &&
            !Array.isArray(data.years)) {
        for (const [year, meta] of Object.entries(data.years)) {
            if (!/^\d{4}$/.test(year) || meta === null || typeof meta !== 'object')
                continue;

            years[year] = {
                updatedAt: Number(meta.updatedAt) || 0,
                confirmed: Boolean(meta.confirmed),
            };
        }
    }

    for (const holiday of holidays) {
        const year = String(yearOf(holiday.start));

        if (!years[year])
            years[year] = {updatedAt: 0, confirmed: true};
    }

    for (const workday of workdays) {
        const year = String(yearOf(workday.date));

        if (!years[year])
            years[year] = {updatedAt: 0, confirmed: true};
    }

    return {holidays, workdays, years};
}

// --- state transitions -------------------------------------------------------

// Replaces every stored entry for `year` with the freshly parsed calendar and
// marks the year confirmed. Used only for a usable (non-empty) response.
export function recordSuccess(state, year, parsed, nowMs = Date.now()) {
    const key = String(year);
    const holidays = mergeHolidays(
        state.holidays.filter(h => String(yearOf(h.start)) !== key),
        parsed.holidays
    );
    const workdays = mergeWorkdays(
        state.workdays.filter(w => String(yearOf(w.date)) !== key),
        parsed.workdays
    );

    return {
        holidays,
        workdays,
        years: {
            ...state.years,
            [key]: {updatedAt: nowMs, confirmed: true},
        },
    };
}

// Records that `year` was fetched but produced no usable data (network error,
// invalid payload, or an empty future-year calendar). Existing data and the
// `confirmed` flag are preserved, only the refresh timestamp moves so the year
// is retried on the next daily check rather than on every update tick.
export function recordAttempt(state, year, nowMs = Date.now()) {
    const key = String(year);
    const previous = state.years?.[key];

    return {
        ...state,
        years: {
            ...state.years,
            [key]: {
                updatedAt: nowMs,
                confirmed: previous?.confirmed ?? false,
            },
        },
    };
}

// --- refresh planning --------------------------------------------------------

// The years the calculator needs: always the current Chinese year, plus the
// next year from November 1 onwards so that January dates are ready in time.
export function requiredYears(now = new Date()) {
    const year = chinaYear(now);
    const years = [year];

    if (chinaMonth(now) >= 11)
        years.push(year + 1);

    return years;
}

// A year is due when it has never been attempted, or its last attempt is at
// least REFRESH_INTERVAL_MS old. This also throttles retries of a future year
// whose calendar is not published yet.
export function isRefreshDue(now, cacheState, year) {
    const meta = cacheState?.years?.[String(year)];

    if (!meta)
        return true;

    return now.getTime() - (Number(meta.updatedAt) || 0) >= REFRESH_INTERVAL_MS;
}

export function yearsToFetch(now, cacheState, {manual = false} = {}) {
    return requiredYears(now).filter(
        year => manual || isRefreshDue(now, cacheState, year)
    );
}
