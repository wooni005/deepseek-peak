#!/usr/bin/env node
// Dev-hulpmiddel: print exact dezelfde popup-inhoud als de GNOME-extensie,
// zonder de shell te herstarten. De menu-inhoud komt uit dezelfde pure functie
// (pricing.js -> buildMenuModel) die extension.js naar echte PopupMenu-items
// rendert, dus dit is geen nabouw.
//
// Gebruik:
//     node scripts/status.js                       # nu
//     node scripts/status.js 2026-10-10T02:00:00Z  # specifiek moment
//
// Leest de cache die de extensie wegschrijft (of valt terug op de seed-tabel).

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
let cacheInfo = 'geen cache, alleen seed-tabel';

if (existsSync(cachePath)) {
    try {
        const data = JSON.parse(readFileSync(cachePath, 'utf8'));

        if (Array.isArray(data.holidays))
            holidays = mergeHolidays(holidays, data.holidays);
        if (Array.isArray(data.workdays))
            workdays = mergeWorkdays(workdays, data.workdays);

        cacheInfo = `${cachePath} (${holidays.length} feestdagen, ${workdays.length} compensatiedagen)`;
    } catch (e) {
        cacheInfo = `${cachePath} lezen mislukt: ${e.message}`;
    }
}

const arg = process.argv[2];
const now = arg ? new Date(arg) : new Date();

if (Number.isNaN(now.getTime())) {
    console.error(`Ongeldige datum: ${arg}`);
    process.exit(2);
}

const model = buildMenuModel(now, holidays, workdays);

console.log(`Panel: ${model.peak ? '🔴 Piektarief' : '🟢 Daltarief'}`);
console.log(`Moment: ${now.toISOString()}`);
console.log('');
console.log('Popup-menu:');

for (const entry of model.items) {
    if (entry.kind === 'separator')
        console.log('────────────────────────────');
    else
        console.log(entry.text);
}

console.log('');
console.log(`# dev: cache = ${cacheInfo}`);
