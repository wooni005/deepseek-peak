// Node.js tests for the GNOME-independent pricing logic.
//
// Run:
//     node tests/pricing-test.js
//
// The script exits with code 0 if everything passes and 1 if a test fails.

import {
    CHINESE_HOLIDAYS,
    findHoliday,
    findWorkday,
    formatLocalHour,
    formatWhen,
    getStatus,
    isPeak,
    nextTransition,
    parseCalendar,
} from '../pricing.js';

const HOLIDAYS = CHINESE_HOLIDAYS;

let passed = 0;
let failed = 0;

function utc(iso) {
    return new Date(iso);
}

function peakLabel(peak) {
    return peak ? 'PEAK' : 'OFF-PEAK';
}

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

function checkPeak(iso, expected) {
    const now = utc(iso);
    check(
        `${iso} → ${peakLabel(isPeak(now, HOLIDAYS))}`,
        peakLabel(isPeak(now, HOLIDAYS)),
        expected
    );
}

function checkTransition(iso, expectedIso) {
    const next = nextTransition(utc(iso), HOLIDAYS);
    check(
        `${iso} → next transition ${next ? next.toISOString() : 'none'}`,
        next ? next.toISOString() : null,
        expectedIso
    );
}

// Parses a time string to a 24-hour hour, regardless of the system locale
// (e.g. "02:00", "2:00 AM", "14:00").
function hour24(formatted) {
    const match = formatted.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (!match)
        return NaN;

    let hour = Number(match[1]);
    const meridiem = match[3]?.toUpperCase();

    if (meridiem === 'PM' && hour < 12)
        hour += 12;
    if (meridiem === 'AM' && hour === 12)
        hour = 0;

    return hour;
}

console.log('DeepSeek pricing tests\n');

// 1. Monday to Friday 01:00-04:00 UTC = PEAK
console.log('1) Workdays 01:00-04:00 UTC = PEAK (2026-10-14, not a holiday)');
checkPeak('2026-10-14T01:00:00Z', 'PEAK');
checkPeak('2026-10-14T02:00:00Z', 'PEAK');
checkPeak('2026-10-14T03:59:00Z', 'PEAK');

// 2. Monday to Friday 06:00-10:00 UTC = PEAK
console.log('\n2) Workdays 06:00-10:00 UTC = PEAK');
checkPeak('2026-10-14T06:00:00Z', 'PEAK');
checkPeak('2026-10-14T09:59:00Z', 'PEAK');

// 3. Outside these windows = OFF-PEAK
console.log('\n3) Outside the peak windows = OFF-PEAK');
checkPeak('2026-10-14T00:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T04:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T05:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T10:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T23:00:00Z', 'OFF-PEAK');

// 4. Saturday = OFF-PEAK
console.log('\n4) Saturday = OFF-PEAK');
checkPeak('2026-10-10T02:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-10T07:00:00Z', 'OFF-PEAK');

// 5. Sunday = OFF-PEAK
console.log('\n5) Sunday = OFF-PEAK');
checkPeak('2026-10-11T02:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-11T07:00:00Z', 'OFF-PEAK');

// 6. Chinese holiday during a normal peak window = OFF-PEAK
console.log('\n6) Chinese holiday during a peak window = OFF-PEAK');
checkPeak('2026-10-01T02:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-07T07:00:00Z', 'OFF-PEAK');

// 7. Day after a Chinese holiday = normal calculation
console.log('\n7) Day after a Chinese holiday = normal calculation');
checkPeak('2026-10-08T02:00:00Z', 'PEAK');
checkPeak('2026-10-08T05:00:00Z', 'OFF-PEAK');
check(
    '2026-10-08 is not a holiday',
    findHoliday(utc('2026-10-08T02:00:00Z'), HOLIDAYS),
    null
);

// 8. Transition exactly at 04:00 UTC
console.log('\n8) Transition exactly at 04:00 UTC');
checkTransition('2026-10-14T02:00:00Z', '2026-10-14T04:00:00.000Z');
checkTransition('2026-10-14T03:30:00Z', '2026-10-14T04:00:00.000Z');

// 9. Transition exactly at 06:00 UTC
console.log('\n9) Transition exactly at 06:00 UTC');
checkTransition('2026-10-14T05:00:00Z', '2026-10-14T06:00:00.000Z');

// 10. Transition exactly at 10:00 UTC
console.log('\n10) Transition exactly at 10:00 UTC');
checkTransition('2026-10-14T09:00:00Z', '2026-10-14T10:00:00.000Z');

// 11. Correct next transition across midnight
console.log('\n11) Next transition across midnight');
checkTransition('2026-10-14T23:00:00Z', '2026-10-15T01:00:00.000Z');
checkTransition('2026-10-09T10:00:00Z', '2026-10-12T01:00:00.000Z');

// 12. Correct local time for Europe/Prague, including summer and winter time
console.log('\n12) Local time Europe/Prague (summer + winter)');
const pragueWinter = utc('2026-01-15T12:00:00Z');
const pragueSummer = utc('2026-07-15T12:00:00Z');

const winterOpen = formatLocalHour(1, pragueWinter, 'Europe/Prague');
const winterClose = formatLocalHour(6, pragueWinter, 'Europe/Prague');
const summerOpen = formatLocalHour(1, pragueSummer, 'Europe/Prague');
const summerClose = formatLocalHour(6, pragueSummer, 'Europe/Prague');

check(`winter 01:00 UTC → ${winterOpen} local (CET, expected 02:00)`, hour24(winterOpen), 2);
check(`winter 06:00 UTC → ${winterClose} local (CET, expected 07:00)`, hour24(winterClose), 7);
check(`summer 01:00 UTC → ${summerOpen} local (CEST, expected 03:00)`, hour24(summerOpen), 3);
check(`summer 06:00 UTC → ${summerClose} local (CEST, expected 08:00)`, hour24(summerClose), 8);

// Extra: parseCalendar also returns Chinese compensatory workdays.
console.log('\n13) parseCalendar: holidays + compensatory workdays');
const parsed = parseCalendar({
    days: [
        {name: 'National Day', date: '2026-10-01', isOffDay: true},
        {name: 'Compensatory workday', date: '2026-09-27', isOffDay: false},
    ],
});
check('one holiday parsed', parsed.holidays.length, 1);
check('one compensatory workday parsed', parsed.workdays.length, 1);
check('compensatory workday date', parsed.workdays[0].date, '2026-09-27');

// Extra: formatWhen shows only a time on the same day and date+time otherwise.
console.log('\n14) formatWhen: same day vs. different day');
const sameDay = formatWhen(utc('2026-10-14T04:00:00Z'), utc('2026-10-14T02:00:00Z'), 'UTC');
const otherDay = formatWhen(utc('2026-10-15T04:00:00Z'), utc('2026-10-14T02:00:00Z'), 'UTC');
check(`same day → "${sameDay}"`, sameDay, '04:00');
check(`different day contains "04:00"`, otherDay.includes('04:00'), true);
check(`different day contains "15" (day of month)`, otherDay.includes('15'), true);

// Extra: getStatus bundles peak, holiday, stale and next transition.
console.log('\n15) getStatus: combined current status');
const status = getStatus(utc('2026-10-14T02:00:00Z'), HOLIDAYS);
check('status.peak = true', status.peak, true);
check('status.holiday = null', status.holiday, null);
check('status.stale = true (after last table date)', status.stale, true);
check(
    'status.nextTransition = 2026-10-14T04:00',
    status.nextTransition?.toISOString(),
    '2026-10-14T04:00:00.000Z'
);

const holidayStatus = getStatus(utc('2026-10-07T02:00:00Z'), HOLIDAYS);
check('holiday: status.peak = false', holidayStatus.peak, false);
check('holiday: status.holidayName', holidayStatus.holidayName, 'National Day');

// 16. Chinese compensatory workdays count as a workday.
console.log('\n16) Compensatory workdays treated as a workday');
const satWorkday = [{name: 'Compensatory workday', date: '2026-10-10'}]; // Saturday
const sunWorkday = [{name: 'Compensatory workday', date: '2026-10-11'}]; // Sunday

check(
    'Saturday 02:00 without compensatory day = OFF-PEAK',
    peakLabel(isPeak(utc('2026-10-10T02:00:00Z'), HOLIDAYS)),
    'OFF-PEAK'
);
check(
    'Saturday 02:00 with compensatory day = PEAK',
    peakLabel(isPeak(utc('2026-10-10T02:00:00Z'), HOLIDAYS, satWorkday)),
    'PEAK'
);
check(
    'Saturday 05:00 with compensatory day = OFF-PEAK (outside window)',
    peakLabel(isPeak(utc('2026-10-10T05:00:00Z'), HOLIDAYS, satWorkday)),
    'OFF-PEAK'
);
check(
    'Sunday 06:00 with compensatory day = PEAK',
    peakLabel(isPeak(utc('2026-10-11T06:00:00Z'), HOLIDAYS, sunWorkday)),
    'PEAK'
);
check(
    'findWorkday finds the day',
    findWorkday(utc('2026-10-10T02:00:00Z'), satWorkday)?.name,
    'Compensatory workday'
);
check(
    'nextTransition from Fri 10:00 jumps to the Sat compensatory day',
    nextTransition(utc('2026-10-09T10:00:00Z'), HOLIDAYS, satWorkday)?.toISOString(),
    '2026-10-10T01:00:00.000Z'
);
check(
    'holiday takes precedence over compensatory day',
    peakLabel(isPeak(utc('2026-10-07T02:00:00Z'), HOLIDAYS, [{name: 'x', date: '2026-10-07'}])),
    'OFF-PEAK'
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0)
    process.exit(1);
