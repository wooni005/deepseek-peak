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
// Reads the cache that the extension writes. Without a cache the downloaded
// calendar is simply empty, so the plain Mon-Fri / weekend rules apply.

import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {buildMenuModel} from '../pricing.js';
import {parseCache} from '../holidays.js';

const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
const cachePath = process.env.DEEPSEEK_PEAK_CACHE ??
    join(dataHome, 'deepseek-peak', 'holidays.json');

let holidays = [];
let cacheInfo = 'no cache';

if (existsSync(cachePath)) {
    try {
        const state = parseCache(readFileSync(cachePath, 'utf8'));

        if (state) {
            holidays = state.holidays;
            cacheInfo = `${cachePath} (${holidays.length} holidays)`;
        } else {
            cacheInfo = `${cachePath} invalid`;
        }
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

const model = buildMenuModel(now, holidays);

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
