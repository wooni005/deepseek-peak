#!/usr/bin/env node
// Dev tool: prints exactly the same popup contents as the GNOME extension,
// without restarting the shell. The menu contents come from the same pure
// function (pricing.js -> buildMenuModel) that extension.js renders into real
// PopupMenu items, so this is not a re-implementation.
//
// Usage:
//     node scripts/status.js                       # now
//     node scripts/status.js 2026-10-10T02:00:00Z  # specific moment
//
// Reads the cache that the extension writes (or falls back to the seed table).

import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {
    CHINESE_HOLIDAYS,
    buildMenuModel,
    mergeHolidays,
    mergeWorkdays,
} from '../pricing.js';

const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
const cachePath = process.env.DEEPSEEK_PEAK_CACHE ??
    join(dataHome, 'deepseek-peak', 'holidays.json');

let holidays = [...CHINESE_HOLIDAYS];
let workdays = [];
let cacheInfo = 'no cache, seed table only';

if (existsSync(cachePath)) {
    try {
        const data = JSON.parse(readFileSync(cachePath, 'utf8'));

        if (Array.isArray(data.holidays))
            holidays = mergeHolidays(holidays, data.holidays);
        if (Array.isArray(data.workdays))
            workdays = mergeWorkdays(workdays, data.workdays);

        cacheInfo = `${cachePath} (${holidays.length} holidays, ${workdays.length} compensatory workdays)`;
    } catch (e) {
        cacheInfo = `${cachePath} read failed: ${e.message}`;
    }
}

const arg = process.argv[2];
const now = arg ? new Date(arg) : new Date();

if (Number.isNaN(now.getTime())) {
    console.error(`Invalid date: ${arg}`);
    process.exit(2);
}

const model = buildMenuModel(now, holidays, workdays);

console.log(`Panel: ${model.panelLabel}`);
console.log(`Moment: ${now.toISOString()}`);
console.log('');
console.log('Popup menu:');

for (const entry of model.items) {
    if (entry.kind === 'separator')
        console.log('────────────────────────────');
    else
        console.log(entry.text);
}

console.log('');
console.log(`# dev: cache = ${cacheInfo}`);
