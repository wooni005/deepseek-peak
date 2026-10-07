// Node.js tests voor de GNOME-onafhankelijke pricinglogica.
//
// Uitvoeren:
//     node tests/pricing-test.js
//
// Het script eindigt met exitcode 0 als alles slaagt en 1 als een test faalt.

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
        console.log(`    verwacht:  ${expected}`);
        console.log(`    werkelijk: ${actual}`);
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
        `${iso} → volgende wisseling ${next ? next.toISOString() : 'geen'}`,
        next ? next.toISOString() : null,
        expectedIso
    );
}

// Parseert een tijdstring naar een 24-uurs uur, ongeacht de systeemlocale
// (bijv. "02:00", "2:00 AM", "14:00").
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

// 1. Maandag t/m vrijdag 01:00-04:00 UTC = PEAK
console.log('1) Werkdagen 01:00-04:00 UTC = PEAK (2026-10-14, geen feestdag)');
checkPeak('2026-10-14T01:00:00Z', 'PEAK');
checkPeak('2026-10-14T02:00:00Z', 'PEAK');
checkPeak('2026-10-14T03:59:00Z', 'PEAK');

// 2. Maandag t/m vrijdag 06:00-10:00 UTC = PEAK
console.log('\n2) Werkdagen 06:00-10:00 UTC = PEAK');
checkPeak('2026-10-14T06:00:00Z', 'PEAK');
checkPeak('2026-10-14T09:59:00Z', 'PEAK');

// 3. Buiten deze tijden = OFF-PEAK
console.log('\n3) Buiten de piekvensters = OFF-PEAK');
checkPeak('2026-10-14T00:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T04:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T05:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T10:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-14T23:00:00Z', 'OFF-PEAK');

// 4. Zaterdag = OFF-PEAK
console.log('\n4) Zaterdag = OFF-PEAK');
checkPeak('2026-10-10T02:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-10T07:00:00Z', 'OFF-PEAK');

// 5. Zondag = OFF-PEAK
console.log('\n5) Zondag = OFF-PEAK');
checkPeak('2026-10-11T02:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-11T07:00:00Z', 'OFF-PEAK');

// 6. Chinese feestdag tijdens een normaal peak-venster = OFF-PEAK
console.log('\n6) Chinese feestdag tijdens piekvenster = OFF-PEAK');
checkPeak('2026-10-01T02:00:00Z', 'OFF-PEAK');
checkPeak('2026-10-07T07:00:00Z', 'OFF-PEAK');

// 7. Dag na een Chinese feestdag = normale berekening
console.log('\n7) Dag na een Chinese feestdag = normale berekening');
checkPeak('2026-10-08T02:00:00Z', 'PEAK');
checkPeak('2026-10-08T05:00:00Z', 'OFF-PEAK');
check(
    '2026-10-08 is geen feestdag',
    findHoliday(utc('2026-10-08T02:00:00Z'), HOLIDAYS),
    null
);

// 8. Overgang exact op 04:00 UTC
console.log('\n8) Overgang exact op 04:00 UTC');
checkTransition('2026-10-14T02:00:00Z', '2026-10-14T04:00:00.000Z');
checkTransition('2026-10-14T03:30:00Z', '2026-10-14T04:00:00.000Z');

// 9. Overgang exact op 06:00 UTC
console.log('\n9) Overgang exact op 06:00 UTC');
checkTransition('2026-10-14T05:00:00Z', '2026-10-14T06:00:00.000Z');

// 10. Overgang exact op 10:00 UTC
console.log('\n10) Overgang exact op 10:00 UTC');
checkTransition('2026-10-14T09:00:00Z', '2026-10-14T10:00:00.000Z');

// 11. Correcte volgende overgang over middernacht
console.log('\n11) Volgende overgang over middernacht');
checkTransition('2026-10-14T23:00:00Z', '2026-10-15T01:00:00.000Z');
checkTransition('2026-10-09T10:00:00Z', '2026-10-12T01:00:00.000Z');

// 12. Correcte lokale tijd voor Europe/Prague, inclusief zomer- en wintertijd
console.log('\n12) Lokale tijd Europe/Prague (zomer + winter)');
const pragueWinter = utc('2026-01-15T12:00:00Z');
const pragueSummer = utc('2026-07-15T12:00:00Z');

const winterOpen = formatLocalHour(1, pragueWinter, 'Europe/Prague');
const winterClose = formatLocalHour(6, pragueWinter, 'Europe/Prague');
const summerOpen = formatLocalHour(1, pragueSummer, 'Europe/Prague');
const summerClose = formatLocalHour(6, pragueSummer, 'Europe/Prague');

check(`winter 01:00 UTC → ${winterOpen} lokaal (CET, verwacht 02:00)`, hour24(winterOpen), 2);
check(`winter 06:00 UTC → ${winterClose} lokaal (CET, verwacht 07:00)`, hour24(winterClose), 7);
check(`zomer  01:00 UTC → ${summerOpen} lokaal (CEST, verwacht 03:00)`, hour24(summerOpen), 3);
check(`zomer  06:00 UTC → ${summerClose} lokaal (CEST, verwacht 08:00)`, hour24(summerClose), 8);

// Extra: parseCalendar levert ook Chinese compensatiewerkdagen op.
console.log('\n13) parseCalendar: feestdagen + compensatiewerkdagen');
const parsed = parseCalendar({
    days: [
        {name: 'Nationale feestdag', date: '2026-10-01', isOffDay: true},
        {name: 'Compensatiewerkdag', date: '2026-09-27', isOffDay: false},
    ],
});
check('één feestdag geparseerd', parsed.holidays.length, 1);
check('één compensatiewerkdag geparseerd', parsed.workdays.length, 1);
check('compensatiewerkdag datum', parsed.workdays[0].date, '2026-09-27');

// Extra: formatWhen toont alleen een tijd op dezelfde dag en datum+tijd anders.
console.log('\n14) formatWhen:zelfde dag vs. andere dag');
const sameDay = formatWhen(utc('2026-10-14T04:00:00Z'), utc('2026-10-14T02:00:00Z'), 'UTC');
const otherDay = formatWhen(utc('2026-10-15T04:00:00Z'), utc('2026-10-14T02:00:00Z'), 'UTC');
check(`zelfde dag → "${sameDay}"`, sameDay, '04:00');
check(`andere dag bevat "04:00"`, otherDay.includes('04:00'), true);
check(`andere dag bevat "15" (dag van de maand)`, otherDay.includes('15'), true);

// Extra: getStatus bundelt peak, feestdag, stale en volgende wisseling.
console.log('\n15) getStatus: samengestelde huidige status');
const status = getStatus(utc('2026-10-14T02:00:00Z'), HOLIDAYS);
check('status.peak = true', status.peak, true);
check('status.holiday = null', status.holiday, null);
check('status.stale = true (na laatste tabeldatum)', status.stale, true);
check(
    'status.nextTransition = 2026-10-14T04:00',
    status.nextTransition?.toISOString(),
    '2026-10-14T04:00:00.000Z'
);

const holidayStatus = getStatus(utc('2026-10-07T02:00:00Z'), HOLIDAYS);
check('feestdag: status.peak = false', holidayStatus.peak, false);
check('feestdag: status.holidayName', holidayStatus.holidayName, 'Nationale feestdag');

// 16. Chinese compensatiewerkdagen (调休) tellen als werkdag.
console.log('\n16) Compensatiewerkdagen behandeld als werkdag');
const satWorkday = [{name: 'Compensatiewerkdag', date: '2026-10-10'}]; // zaterdag
const sunWorkday = [{name: 'Compensatiewerkdag', date: '2026-10-11'}]; // zondag

check(
    'zaterdag 02:00 zonder compensatiedag = OFF-PEAK',
    peakLabel(isPeak(utc('2026-10-10T02:00:00Z'), HOLIDAYS)),
    'OFF-PEAK'
);
check(
    'zaterdag 02:00 met compensatiedag = PEAK',
    peakLabel(isPeak(utc('2026-10-10T02:00:00Z'), HOLIDAYS, satWorkday)),
    'PEAK'
);
check(
    'zaterdag 05:00 met compensatiedag = OFF-PEAK (buiten venster)',
    peakLabel(isPeak(utc('2026-10-10T05:00:00Z'), HOLIDAYS, satWorkday)),
    'OFF-PEAK'
);
check(
    'zondag 06:00 met compensatiedag = PEAK',
    peakLabel(isPeak(utc('2026-10-11T06:00:00Z'), HOLIDAYS, sunWorkday)),
    'PEAK'
);
check(
    'findWorkday vindt de dag',
    findWorkday(utc('2026-10-10T02:00:00Z'), satWorkday)?.name,
    'Compensatiewerkdag'
);
check(
    'nextTransition vanaf vr 10:00 springt naar za-compensatiedag',
    nextTransition(utc('2026-10-09T10:00:00Z'), HOLIDAYS, satWorkday)?.toISOString(),
    '2026-10-10T01:00:00.000Z'
);
check(
    'feestdag gaat voor op compensatiedag',
    peakLabel(isPeak(utc('2026-10-07T02:00:00Z'), HOLIDAYS, [{name: 'x', date: '2026-10-07'}])),
    'OFF-PEAK'
);

console.log(`\n${passed} geslaagd, ${failed} gefaald`);

if (failed > 0)
    process.exit(1);
