import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    CHINESE_HOLIDAYS,
    buildMenuModel,
    holidayUrl,
    isStale,
    lastHolidayEnd,
    mergeHolidays,
    mergeWorkdays,
    parseCalendar,
} from './pricing.js';

import {
    ensureDirectoryAsync,
    readFileBytesAsync,
    writeFileBytesAsync,
} from './gio-async.js';

const CACHE_PATH = GLib.build_filenamev([
    GLib.get_user_data_dir(),
    'deepseek-peak',
    'holidays.json',
]);

const DeepSeekIndicator = GObject.registerClass(
class DeepSeekIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'DeepSeek Peak Pricing');

        this._holidays = [...CHINESE_HOLIDAYS];
        this._workdays = [];
        this._notifiedStale = false;
        this._fetching = false;

        this._loadCachedHolidays();

        this._label = new St.Label({
            text: '⚪ ...',
            y_align: 2,
        });

        this.add_child(this._label);

        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            60,
            () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            }
        );

        this._update();
    }

    _update() {
        const now = new Date();
        const model = buildMenuModel(now, this._holidays, this._workdays);

        this._label.text = model.panelLabel;

        if (model.stale && !this._notifiedStale) {
            this._notifiedStale = true;
            this._notify(
                'Holiday list has expired. Open the menu to refresh.'
            );
        }

        this._renderMenu(model);
    }

    async _loadCachedHolidays() {
        const file = Gio.File.new_for_path(CACHE_PATH);
        let contents;

        try {
            contents = await readFileBytesAsync(file);
        } catch (e) {
            // A missing cache file is expected on the first run.
            if (!(e instanceof GLib.Error &&
                    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)))
                logError(e, 'deepseek-peak: failed to read cache');

            return;
        }

        try {
            const data = JSON.parse(new TextDecoder().decode(contents));

            if (Array.isArray(data.holidays))
                this._holidays = mergeHolidays(this._holidays, data.holidays);

            if (Array.isArray(data.workdays))
                this._workdays = mergeWorkdays(this._workdays, data.workdays);

            this._update();
        } catch (e) {
            logError(e, 'deepseek-peak: failed to parse cache');
        }
    }

    async _saveCachedHolidays() {
        const file = Gio.File.new_for_path(CACHE_PATH);
        const bytes = new TextEncoder().encode(
            JSON.stringify({
                holidays: this._holidays,
                workdays: this._workdays,
            }, null, 2)
        );

        try {
            await ensureDirectoryAsync(file.get_parent());
            await writeFileBytesAsync(file, bytes);
        } catch (e) {
            logError(e, 'deepseek-peak: failed to write cache');
        }
    }

    _fetchHolidays() {
        if (this._fetching)
            return;

        this._fetching = true;

        const nowYear = new Date().getUTCFullYear();
        const lastYear = Number(lastHolidayEnd(this._holidays).slice(0, 4)) || nowYear;

        const years = [];
        for (let year = lastYear; year <= nowYear + 1; year++)
            years.push(year);

        const session = new Soup.Session();
        this._session = session;

        const found = [];
        const foundWorkdays = [];
        let pending = years.length;
        let failed = false;

        years.forEach(year => {
            const message = Soup.Message.new('GET', holidayUrl(year));

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (sess, result) => {
                    try {
                        const bytes = sess.send_and_read_finish(result);
                        const text = new TextDecoder().decode(bytes.get_data());
                        const parsed = parseCalendar(JSON.parse(text));

                        found.push(...parsed.holidays);
                        foundWorkdays.push(...parsed.workdays);
                    } catch (e) {
                        failed = true;
                        logError(e, `deepseek-peak: failed to fetch ${year}`);
                    }

                    if (--pending === 0)
                        this._onFetched(found, foundWorkdays, failed);
                }
            );
        });
    }

    _onFetched(found, foundWorkdays, failed) {
        this._fetching = false;
        this._session = null;

        if (found.length > 0)
            this._holidays = mergeHolidays(this._holidays, found);

        if (foundWorkdays.length > 0)
            this._workdays = mergeWorkdays(this._workdays, foundWorkdays);

        if (found.length > 0 || foundWorkdays.length > 0)
            this._saveCachedHolidays();

        if (isStale(new Date(), this._holidays)) {
            this._notifiedStale = true;
            this._notify(
                failed
                    ? 'Failed to fetch holidays.'
                    : 'No new holidays available yet.'
            );
        } else {
            this._notifiedStale = false;
            this._notify(`Holidays updated (${found.length} days).`);
        }

        this._update();
    }

    _notify(body) {
        try {
            Main.notify('DeepSeek Peak Pricing', body);
        } catch (e) {
            logError(e, 'deepseek-peak: failed to show notification');
        }
    }

    _renderMenu(model) {
        this.menu.removeAll();

        for (const entry of model.items) {
            if (entry.kind === 'separator') {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            } else if (entry.kind === 'action' && entry.action === 'refresh') {
                const item = new PopupMenu.PopupMenuItem(entry.text);
                item.connect('activate', () => this._fetchHolidays());
                this.menu.addMenuItem(item);
            } else {
                const item = new PopupMenu.PopupMenuItem(
                    entry.text,
                    {reactive: false}
                );

                if (entry.style) {
                    for (const name of entry.style.split(' '))
                        item.label.add_style_class_name(name);
                }

                this.menu.addMenuItem(item);
            }
        }
    }
});

export default class DeepSeekPeakExtension extends Extension {
    enable() {
        this._indicator = new DeepSeekIndicator();

        Main.panel.addToStatusArea(
            'deepseek-peak',
            this._indicator
        );
    }

    disable() {
        this._indicator = null;
    }
}
