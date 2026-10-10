#!/usr/bin/env node
// Dev tool: renders the popup for a set of representative day layouts
// (normal workday, weekend, holiday, compensatory workday, out-of-date list,
// ...) without restarting the shell. The contents come from the same pure
// function (pricing.js -> buildMenuModel) that extension.js renders into real
// PopupMenu items, so this is not a re-implementation.
//
// Usage:
//     node scripts/scenarios.js                 # all scenarios
//     node scripts/scenarios.js weekend         # only matching scenarios
//     node scripts/scenarios.js --styles        # annotate lines with CSS classes
//
// The output depends on the local time zone, because peak windows are shown in
// local time. Pin it for reproducible output, e.g.:
//     TZ=Europe/Prague node scripts/scenarios.js
//
// Scenarios intentionally use the checked-in test fixture (not the on-disk
// cache), so every run shows exactly the same layouts.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {buildMenuModel} from '../pricing.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
    readFileSync(join(here, '..', 'tests', 'fixtures', 'holidays.json'), 'utf8')
);
const FIXTURE_HOLIDAYS = FIXTURE.holidays;

// A compensatory workday is a weekend day that the Chinese State Council turns
// into a working day, so the normal peak windows apply on it.
function compensatoryWorkday(date) {
    return {name: 'Compensatory workday', date};
}

const scenarios = [
    {
        title: 'Normal workday — before peak',
        now: '2026-09-23T00:30:00Z',
    },
    {
        title: 'Normal workday — during peak (01:00–04:00 UTC)',
        now: '2026-09-23T02:00:00Z',
    },
    {
        title: 'Normal workday — off-peak gap between windows',
        now: '2026-09-23T05:00:00Z',
    },
    {
        title: 'Normal workday — after both windows',
        now: '2026-09-23T11:00:00Z',
    },
    {
        title: 'Weekend — Saturday',
        now: '2026-09-19T02:00:00Z',
    },
    {
        title: 'Weekend — Sunday',
        now: '2026-09-20T02:00:00Z',
    },
    {
        title: 'Chinese holiday — Mid-Autumn (Saturday)',
        now: '2026-09-26T02:00:00Z',
    },
    {
        title: 'Chinese holiday — National Day (Monday)',
        now: '2026-10-05T02:00:00Z',
    },
    {
        title: 'Compensatory workday — Saturday, during peak',
        now: '2026-09-19T02:00:00Z',
        workdays: [compensatoryWorkday('2026-09-19')],
    },
    {
        title: 'Compensatory workday — Saturday, outside peak window',
        now: '2026-09-19T05:00:00Z',
        workdays: [compensatoryWorkday('2026-09-19')],
    },
    {
        title: 'Defensive: compensatory workday overrides a holiday (inconsistent data)',
        now: '2026-10-05T02:00:00Z',
        workdays: [compensatoryWorkday('2026-10-05')],
    },
    {
        title: 'Friday evening — next peak on Monday (cross-day label)',
        now: '2026-09-18T11:00:00Z',
    },
    {
        title: 'Out-of-date holiday list (warning + refresh button)',
        now: '2028-01-15T02:00:00Z',
    },
    {
        title: 'No transition in sight — synthetic 29-day holiday',
        now: '2026-03-01T02:00:00Z',
        holidays: [{name: 'Synthetic long break', start: '2026-02-20', end: '2026-03-20'}],
    },
];

function parseArgs(argv) {
    const styles = argv.includes('--styles');
    const filter = argv.find(arg => !arg.startsWith('--')) ?? null;

    return {styles, filter};
}

// Renders the popup model as the plain lines a user sees. With `styles`, each
// line is annotated with the CSS classes extension.js applies to it.
function render(model, styles) {
    const lines = [];

    for (const entry of model.items) {
        if (entry.kind === 'separator') {
            lines.push('  ────────────────────────────');
            continue;
        }

        const annotation = styles && entry.style
            ? `   (${entry.style})`
            : '';

        lines.push(`  ${entry.text}${annotation}`);
    }

    return lines.join('\n');
}

function momentLabel(date) {
    const weekday = date.toLocaleDateString('en-GB', {
        weekday: 'short',
        timeZone: 'UTC',
    });

    return `${date.toISOString()} (${weekday})`;
}

const {styles, filter} = parseArgs(process.argv.slice(2));

const selected = scenarios.filter(s =>
    !filter || s.title.toLowerCase().includes(filter.toLowerCase())
);

if (selected.length === 0) {
    console.error(`No scenario matches "${filter}".`);
    process.exit(2);
}

console.log('DeepSeek popup scenarios');
console.log(`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`Scenarios: ${selected.length}/${scenarios.length}`);
console.log('');

for (const scenario of selected) {
    const now = new Date(scenario.now);
    const holidays = scenario.holidays ?? FIXTURE_HOLIDAYS;
    const workdays = scenario.workdays ?? [];
    const model = buildMenuModel(now, holidays, workdays);

    console.log('='.repeat(60));
    console.log(scenario.title);
    console.log('='.repeat(60));
    console.log(`Moment:  ${momentLabel(now)}`);
    console.log(`Panel:   ${model.panelLabel}`);
    console.log('');
    console.log('Popup menu:');
    console.log(render(model, styles));
    console.log('');
}
