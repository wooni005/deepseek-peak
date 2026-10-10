// Node.js tests for the pure holiday-data management (holidays.js).
//
// Run:
//     node tests/holidays-test.js
//
// The script exits with code 0 if everything passes and 1 if a test fails.

import {
    REFRESH_INTERVAL_MS,
    holidayUrl,
    isRefreshDue,
    parseCache,
    parseCalendar,
    recordAttempt,
    recordSuccess,
    requiredYears,
    serializeCache,
    yearsToFetch,
} from '../holidays.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    if (Object.is(actual, expected)) {
        passed++;
        console.log(`✓ ${label}`);
    } else {
        failed++;
        console.log(`✗ ${label}`);
        console.log(`    expected: ${expected}`);
        console.log(`    actual:   ${actual}`);
    }
}

function checkDeep(label, actual, expected) {
    check(label, JSON.stringify(actual), JSON.stringify(expected));
}

function utc(iso) {
    return new Date(iso);
}

console.log('DeepSeek holiday-data tests\n');

// 1. URL.
console.log('1) holidayUrl');
check(
    'URL points at the yearly file',
    holidayUrl(2026),
    'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json'
);

// 2. parseCalendar: valid data.
console.log('\n2) parseCalendar: valid data');
const valid = parseCalendar({
    year: 2026,
    days: [
        {name: '元旦', date: '2026-01-01', isOffDay: true},
        {name: '春节', date: '2026-02-14', isOffDay: false},
    ],
}, 2026);
check('valid = true', valid.valid, true);
check('usable = true', valid.usable, true);
check('dayCount = 2', valid.dayCount, 2);
check('one holiday', valid.holidays.length, 1);
check('holiday start', valid.holidays[0].start, '2026-01-01');
check('workdays are not stored', 'workdays' in valid, false);

// 3. parseCalendar: empty future year is structurally valid but not usable.
console.log('\n3) parseCalendar: empty future-year days');
const empty = parseCalendar({year: 2027, days: [], papers: []}, 2027);
check('valid = true', empty.valid, true);
check('usable = false (not confirmed data)', empty.usable, false);
check('dayCount = 0', empty.dayCount, 0);
check('no holidays', empty.holidays.length, 0);

// 4. parseCalendar: rejections.
console.log('\n4) parseCalendar: invalid payloads');
check('null → invalid', parseCalendar(null, 2026).valid, false);
check('array → invalid', parseCalendar([], 2026).valid, false);
check('missing days → invalid', parseCalendar({year: 2026}, 2026).valid, false);
check(
    'mismatched year field → invalid',
    parseCalendar({year: 2025, days: []}, 2026).valid,
    false
);
check(
    'bad date → invalid',
    parseCalendar({year: 2026, days: [{name: 'x', date: '2026-1-1', isOffDay: true}]}, 2026).valid,
    false
);
check(
    'impossible date → invalid',
    parseCalendar({year: 2026, days: [{name: 'x', date: '2026-02-30', isOffDay: true}]}, 2026).valid,
    false
);
check(
    'date from another year → invalid',
    parseCalendar({year: 2026, days: [{name: 'x', date: '2027-01-01', isOffDay: true}]}, 2026).valid,
    false
);
check(
    'non-boolean isOffDay → invalid',
    parseCalendar({year: 2026, days: [{name: 'x', date: '2026-01-01', isOffDay: 'yes'}]}, 2026).valid,
    false
);

// 5. Cache round-trip.
console.log('\n5) cache serialize / parse round-trip');
const state = {
    holidays: [{name: 'National Day', start: '2026-10-01', end: '2026-10-07'}],
    years: {'2026': {updatedAt: 123456, confirmed: true}},
};
const restored = parseCache(serializeCache(state));
checkDeep('holidays preserved', restored.holidays, state.holidays);
checkDeep('years metadata preserved', restored.years, state.years);
check('serialized version is 3', JSON.parse(serializeCache(state)).version, 3);
check('workdays are not serialized', 'workdays' in JSON.parse(serializeCache(state)), false);

// 6. parseCache: malformed and legacy input.
console.log('\n6) parseCache: malformed and legacy input');
check('invalid JSON → null', parseCache('{not json'), null);
check('non-object JSON → null', parseCache('42'), null);
const legacy = parseCache(JSON.stringify({
    holidays: [{name: 'National Day', start: '2026-10-01', end: '2026-10-07'}],
    workdays: [{name: 'Compensatory workday', date: '2026-10-10'}],
}));
check('legacy: 2026 derived', legacy.years['2026'].confirmed, true);
check('legacy: refresh timestamp is 0 (refresh due)', legacy.years['2026'].updatedAt, 0);
check('legacy: workdays ignored', 'workdays' in legacy, false);
const dirty = parseCache(JSON.stringify({
    holidays: [
        {name: 'ok', start: '2026-10-01', end: '2026-10-07'},
        {name: 'reversed', start: '2026-10-09', end: '2026-10-01'},
        {name: 'bad', start: 'nope', end: 'nope'},
    ],
}));
check('dirty: only valid holiday kept', dirty.holidays.length, 1);

// 7. requiredYears uses China time and the November switch.
console.log('\n7) requiredYears (China time, November switch)');
checkDeep('October → current year', requiredYears(utc('2026-10-10T00:00:00Z')), [2026]);
checkDeep('Oct 31 20:00 UTC is Nov 1 in China', requiredYears(utc('2026-10-31T20:00:00Z')), [2026, 2027]);
checkDeep('December → current + next', requiredYears(utc('2026-12-15T12:00:00Z')), [2026, 2027]);
checkDeep('January → only the new current year', requiredYears(utc('2027-01-01T00:00:00Z')), [2027]);

// 8. Refresh throttling.
console.log('\n8) isRefreshDue / yearsToFetch');
const fresh = {
    holidays: [],
    years: {'2026': {updatedAt: Date.parse('2026-10-10T00:00:00Z'), confirmed: true}},
};
const now = utc('2026-10-10T12:00:00Z');
check('fresh year is not due', isRefreshDue(now, fresh, 2026), false);
check(
    'year is due after 24h',
    isRefreshDue(new Date(now.getTime() + REFRESH_INTERVAL_MS), fresh, 2026),
    true
);
checkDeep('no fetch when fresh', yearsToFetch(now, fresh), []);
checkDeep('manual bypasses the interval', yearsToFetch(now, fresh, {manual: true}), [2026]);

const december = utc('2026-12-15T12:00:00Z');
const withOnly2026 = {
    holidays: [],
    years: {'2026': {updatedAt: december.getTime(), confirmed: true}},
};
checkDeep(
    'missing next year is fetched in December',
    yearsToFetch(december, withOnly2026),
    [2027]
);
checkDeep(
    'manual fetches both required years',
    yearsToFetch(december, withOnly2026, {manual: true}),
    [2026, 2027]
);

// 9. recordSuccess replaces a year and confirms it.
console.log('\n9) recordSuccess');
const beforeReplace = {
    holidays: [
        {name: 'old', start: '2026-01-01', end: '2026-01-01'},
        {name: 'keep', start: '2025-01-01', end: '2025-01-01'},
    ],
    years: {},
};
const afterReplace = recordSuccess(beforeReplace, 2026, valid, 999);
check('year entries replaced', afterReplace.holidays.length, 2);
check(
    'old 2026 entry gone',
    afterReplace.holidays.some(h => h.name === 'old'),
    false
);
check(
    'other year kept',
    afterReplace.holidays.some(h => h.name === 'keep'),
    true
);
check('year confirmed', afterReplace.years['2026'].confirmed, true);

// 10. recordAttempt keeps data and confirmation, only moves the timestamp.
console.log('\n10) recordAttempt keeps cached data');
const confirmed = {
    holidays: [{name: 'National Day', start: '2026-10-01', end: '2026-10-07'}],
    years: {'2026': {updatedAt: 1, confirmed: true}},
};
const attempted = recordAttempt(confirmed, 2026, 5000);
checkDeep('data preserved', attempted.holidays, confirmed.holidays);
check('confirmation preserved', attempted.years['2026'].confirmed, true);
check('timestamp moved', attempted.years['2026'].updatedAt, 5000);
const failedFuture = recordAttempt({holidays: [], years: {}}, 2027, 5000);
check('new future year is unconfirmed', failedFuture.years['2027'].confirmed, false);

// 11. First startup and the unavailable-future-year retry throttle.
console.log('\n11) first startup and future-year throttle');
const emptyState = {holidays: [], years: {}};
checkDeep(
    'first startup fetches the current year',
    yearsToFetch(utc('2026-10-10T12:00:00Z'), emptyState),
    [2026]
);
const decNow = utc('2026-12-15T18:00:00Z');
const justAttempted = {
    holidays: [],
    years: {
        '2026': {updatedAt: decNow.getTime() - 1000, confirmed: true},
        '2027': {updatedAt: decNow.getTime() - 1000, confirmed: false},
    },
};
checkDeep(
    'unavailable 2027 is not retried within 24h',
    yearsToFetch(decNow, justAttempted),
    []
);
check(
    'manual refresh retries the unavailable future year immediately',
    yearsToFetch(decNow, justAttempted, {manual: true}).includes(2027),
    true
);
const nextDay = new Date(decNow.getTime() + REFRESH_INTERVAL_MS + 1000);
const retryState = {
    holidays: [],
    years: {
        '2026': {updatedAt: nextDay.getTime() - 1000, confirmed: true},
        '2027': {updatedAt: decNow.getTime(), confirmed: false},
    },
};
checkDeep(
    'unavailable 2027 is retried the next day',
    yearsToFetch(nextDay, retryState),
    [2027]
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0)
    process.exit(1);
