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

        this._label.text = model.peak
            ? '🔴 Piektarief'
            : '🟢 Daltarief';

        if (model.stale && !this._notifiedStale) {
            this._notifiedStale = true;
            this._notify(
                'Feestdagenlijst is verlopen. Open het menu om bij te werken.'
            );
        }

        this._renderMenu(model);
    }

    _loadCachedHolidays() {
        const file = Gio.File.new_for_path(CACHE_PATH);

        if (!file.query_exists(null))
            return;

        try {
            const [, contents] = file.load_contents(null);
            const data = JSON.parse(new TextDecoder().decode(contents));

            if (Array.isArray(data.holidays))
                this._holidays = mergeHolidays(this._holidays, data.holidays);

            if (Array.isArray(data.workdays))
                this._workdays = mergeWorkdays(this._workdays, data.workdays);
        } catch (e) {
            logError(e, 'deepseek-peak: cache lezen mislukt');
        }
    }

    _saveCachedHolidays() {
        try {
            const file = Gio.File.new_for_path(CACHE_PATH);
            const dir = file.get_parent();

            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);

            const bytes = new TextEncoder().encode(
                JSON.stringify({
                    holidays: this._holidays,
                    workdays: this._workdays,
                }, null, 2)
            );

            file.replace_contents(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            logError(e, 'deepseek-peak: cache schrijven mislukt');
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
                        logError(e, `deepseek-peak: ${year} ophalen mislukt`);
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
                    ? 'Feestdagen ophalen mislukt.'
                    : 'Nog geen nieuwe feestdagen beschikbaar.'
            );
        } else {
            this._notifiedStale = false;
            this._notify(`Feestdagen bijgewerkt (${found.length} dagen).`);
        }

        this._update();
    }

    _notify(body) {
        try {
            Main.notify('DeepSeek Peak Pricing', body);
        } catch (e) {
            logError(e, 'deepseek-peak: melding tonen mislukt');
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
                this.menu.addMenuItem(
                    new PopupMenu.PopupMenuItem(entry.text, {reactive: false})
                );
            }
        }
    }

    destroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }

        super.destroy();
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
        this._indicator?.destroy();
        this._indicator = null;
    }
}
