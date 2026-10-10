// Node.js tests for the GNOME-independent pricing logic.
//
// Run:
//     node tests/pricing-test.js
//
// The script exits with code 0 if everything passes and 1 if a test fails.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {
    buildMenuModel,
    findHoliday,
    findWorkday,
    formatLocalHour,
    formatWhen,
    getStatus,
    isPeak,
    isStale,
    nextTransition,
} from '../pricing.js';

import {parseCalendar} from '../holidays.js';

// The extension no longer ships a hardcoded holiday table; the tests use the
// same downloaded-style fixture data as scripts/scenarios.js.
const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'holidays.json'
);
const FIXTURE = JSON.parse(readFileSync(fixturePath, 'utf8'));

const HOLIDAYS = FIXTURE.holidays;
const WORKDAYS = FIXTURE.workdays;

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
check(
    'status.stale = false (current year data is present)',
    status.stale,
    false
);
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
    'compensatory day overrides a holiday (workday wins)',
    peakLabel(isPeak(utc('2026-10-07T02:00:00Z'), HOLIDAYS, [{name: 'x', date: '2026-10-07'}])),
    'PEAK'
);

// 17. Popup hierarchy and the "Peak hours today" line.
// The same buildMenuModel() drives both the GNOME popup and scripts/status.js.
function itemTexts(model) {
    return model.items
        .filter(i => i.kind === 'item')
        .map(i => i.text);
}

function hasText(model, text) {
    return itemTexts(model).includes(text);
}

function todayWindows(now) {
    return [[1, 4], [6, 10]]
        .map(([s, e]) => `${formatLocalHour(s, now)}–${formatLocalHour(e, now)}`)
        .join(' · ');
}

console.log('\n17) Popup: current status, peak-hours line and next peak');

// 17a. Normal workday before peak hours: off-peak, windows still shown.
const before = utc('2026-10-14T00:00:00Z');
const beforeMenu = buildMenuModel(before, HOLIDAYS);
check(
    'before peak: status is off-peak',
    hasText(beforeMenu, '🟢 DeepSeek API: off-peak pricing'),
    true
);
check(
    'before peak: today\'s windows shown',
    hasText(beforeMenu, `Peak hours today: ${todayWindows(before)}`),
    true
);
check(
    'before peak: no red indicator while off-peak',
    itemTexts(beforeMenu).some(t => t.startsWith('🔴')),
    false
);
check(
    'before peak: status carries the off-peak style',
    beforeMenu.items[0].style,
    'deepseek-status deepseek-offpeak'
);

// 17b. During peak hours: peak status plus both windows and off-peak start.
const during = utc('2026-10-14T02:00:00Z');
const duringMenu = buildMenuModel(during, HOLIDAYS);
check(
    'during peak: status is peak',
    hasText(duringMenu, '🔴 DeepSeek API: peak pricing'),
    true
);
check(
    'during peak: both windows still shown',
    hasText(duringMenu, `Peak hours today: ${todayWindows(during)}`),
    true
);
check(
    'during peak: off-peak transition shown',
    itemTexts(duringMenu).some(t => t.startsWith('Off-peak from ')),
    true
);
check(
    'during peak: status carries the peak style',
    duringMenu.items[0].style,
    'deepseek-status deepseek-peak'
);

// 17c. After both windows have ended: off-peak, windows still shown.
const after = utc('2026-10-14T11:00:00Z');
const afterMenu = buildMenuModel(after, HOLIDAYS);
check(
    'after peak: status is off-peak',
    hasText(afterMenu, '🟢 DeepSeek API: off-peak pricing'),
    true
);
check(
    'after peak: both windows still shown',
    hasText(afterMenu, `Peak hours today: ${todayWindows(after)}`),
    true
);
check(
    'after peak: next peak on the following day',
    itemTexts(afterMenu).some(t => t.startsWith('Next peak: ')),
    true
);

// 17d. Compensatory workday on a Saturday: normal windows apply.
const compDay = utc('2026-10-10T02:00:00Z');
const compMenu = buildMenuModel(
    compDay,
    HOLIDAYS,
    [{name: 'Compensatory workday', date: '2026-10-10'}]
);
check(
    'compensatory workday: peak status',
    hasText(compMenu, '🔴 DeepSeek API: peak pricing'),
    true
);
check(
    'compensatory workday: windows shown',
    hasText(compMenu, `Peak hours today: ${todayWindows(compDay)}`),
    true
);
check(
    'compensatory workday: compact workday line',
    hasText(compMenu, '🇨🇳 Chinese compensatory workday'),
    true
);
check(
    'compensatory workday: line sits above the peak-hours line',
    itemTexts(compMenu).indexOf('🇨🇳 Chinese compensatory workday') <
        itemTexts(compMenu).findIndex(t => t.startsWith('Peak hours today:')),
    true
);

// 17d-bis. A compensatory workday that is also a holiday: the workday wins
// (this cannot happen with real data, but the override must be consistent), so
// the holiday line is suppressed and the normal peak windows apply.
const compHolidayMenu = buildMenuModel(
    utc('2026-10-05T02:00:00Z'),
    HOLIDAYS,
    [{name: 'Compensatory workday', date: '2026-10-05'}]
);
check(
    'compensatory holiday: workday line shown',
    hasText(compHolidayMenu, '🇨🇳 Chinese compensatory workday'),
    true
);
check(
    'compensatory holiday: holiday line suppressed by the override',
    hasText(compHolidayMenu, '🎉 Chinese holiday: National Day'),
    false
);
check(
    'compensatory holiday: peak status wins over the holiday',
    hasText(compHolidayMenu, '🔴 DeepSeek API: peak pricing'),
    true
);
check(
    'compensatory holiday: windows shown',
    hasText(
        compHolidayMenu,
        `Peak hours today: ${todayWindows(utc('2026-10-05T02:00:00Z'))}`
    ),
    true
);
check(
    'compensatory holiday: workday line above peak-hours line',
    itemTexts(compHolidayMenu).indexOf('🇨🇳 Chinese compensatory workday') <
        itemTexts(compHolidayMenu).findIndex(t => t.startsWith('Peak hours today:')),
    true
);

// 17e. Regular weekend without peak hours.
const weekend = utc('2026-10-11T02:00:00Z');
const weekendMenu = buildMenuModel(weekend, HOLIDAYS);
check(
    'weekend: no peak hours today',
    hasText(weekendMenu, 'No peak hours today'),
    true
);
check(
    'weekend: no red indicator while off-peak',
    itemTexts(weekendMenu).some(t => t.startsWith('🔴')),
    false
);

// 17f. Chinese holiday: no peak hours, holiday line kept compact.
const holiday = utc('2026-10-05T02:00:00Z');
const holidayMenu = buildMenuModel(holiday, HOLIDAYS);
check(
    'holiday: no peak hours today',
    hasText(holidayMenu, 'No peak hours today'),
    true
);
check(
    'holiday: compact holiday line',
    hasText(holidayMenu, '🎉 Chinese holiday: National Day'),
    true
);
check(
    'holiday: line sits above the peak-hours line',
    itemTexts(holidayMenu).indexOf('🎉 Chinese holiday: National Day') <
        itemTexts(holidayMenu).indexOf('No peak hours today'),
    true
);

// 17g. The Refresh holidays action and local time are preserved. The button is
// shown when the current year has no data (here 2028, which the fixture does
// not cover).
const staleMenu = buildMenuModel(utc('2028-01-15T02:00:00Z'), HOLIDAYS);
check(
    'refresh button kept',
    staleMenu.items.some(
        i => i.kind === 'action' && i.action === 'refresh' &&
            i.text === 'Refresh holidays'
    ),
    true
);
check(
    'local time line removed',
    itemTexts(staleMenu).some(t => t.startsWith('Local time: ')),
    false
);
check(
    'no trailing separator',
    staleMenu.items.some(i => i.kind === 'separator'),
    false
);

// 18. Staleness is about the current Chinese calendar year, not about the last
// holiday date: valid current-year data clears the warning even in December.
console.log('\n18) isStale reflects the current Chinese calendar year');
check(
    'current year covered → not stale',
    isStale(utc('2026-12-15T02:00:00Z'), HOLIDAYS),
    false
);
check(
    'no data → stale',
    isStale(utc('2026-10-14T02:00:00Z'), []),
    true
);
check(
    'missing next year (still current year) → not stale',
    isStale(utc('2026-10-31T12:00:00Z'), HOLIDAYS),
    false
);
check(
    'year boundary: Dec 31 16:30 UTC is Jan 1 in China → stale when 2027 absent',
    isStale(utc('2026-12-31T16:30:00Z'), [
        {name: 'National Day', start: '2026-10-01', end: '2026-10-07'},
    ]),
    true
);

// 19. Fixture compensatory workdays (a weekend day that becomes a workday).
console.log('\n19) Fixture compensatory workdays');
check(
    'Saturday 2026-10-10 with fixture workday = PEAK',
    peakLabel(isPeak(utc('2026-10-10T02:00:00Z'), HOLIDAYS, WORKDAYS)),
    'PEAK'
);
check(
    'Saturday 2026-10-10 without workdays = OFF-PEAK',
    peakLabel(isPeak(utc('2026-10-10T02:00:00Z'), HOLIDAYS)),
    'OFF-PEAK'
);

// 20. Year-boundary dates around December / January.
console.log('\n20) December / January boundary');
check(
    '2026-12-31 (Thursday) during window = PEAK',
    peakLabel(isPeak(utc('2026-12-31T02:00:00Z'), HOLIDAYS, WORKDAYS)),
    'PEAK'
);
check(
    '2027-01-01 is a holiday = OFF-PEAK',
    peakLabel(isPeak(utc('2027-01-01T02:00:00Z'), HOLIDAYS, WORKDAYS)),
    'OFF-PEAK'
);
check(
    '2027-01-09 compensatory Saturday = PEAK',
    peakLabel(isPeak(utc('2027-01-09T02:00:00Z'), HOLIDAYS, WORKDAYS)),
    'PEAK'
);
check(
    '2027-01-04 (Monday, after the holiday) = PEAK',
    peakLabel(isPeak(utc('2027-01-04T02:00:00Z'), HOLIDAYS, WORKDAYS)),
    'PEAK'
);

// 21. China-time helpers used for the fetch schedule.
console.log('\n21) China timezone year/month handling');
check('2026-10-31T20:00Z → China Nov 1', isStale(utc('2026-10-31T20:00:00Z'), HOLIDAYS), false);

// 22. Debug option: force the refresh action visible without a stale warning.
console.log('\n22) alwaysShowRefresh debug option');
const forced = buildMenuModel(
    utc('2026-10-14T02:00:00Z'),
    HOLIDAYS,
    [],
    {alwaysShowRefresh: true}
);
check(
    'refresh action shown while data is current',
    forced.items.some(i => i.kind === 'action' && i.action === 'refresh'),
    true
);
check('still not stale', forced.stale, false);
check(
    'no stale warning alongside the forced button',
    itemTexts(forced).some(t => t.includes('out of date')),
    false
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0)
    process.exit(1);
