import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PEAK_PERIODS = [
    {start: 1, end: 4},
    {start: 6, end: 10},
];

// Officiele Chinese publieke feestdagen (Staatsraad, dagen vrij), als UTC-datums.
// Bron: https://github.com/NateScarlet/holiday-cn (gebaseerd op gov.cn).
// Werk dit jaarlijks bij zodra de kalender van het volgende jaar verschijnt.
const CHINESE_HOLIDAYS = [
    {name: 'Nieuwjaar', start: '2025-01-01', end: '2025-01-01'},
    {name: 'Lentefestival', start: '2025-01-28', end: '2025-02-04'},
    {name: 'Qingming', start: '2025-04-04', end: '2025-04-06'},
    {name: 'Arbeid', start: '2025-05-01', end: '2025-05-05'},
    {name: 'Drakenboot', start: '2025-05-31', end: '2025-06-02'},
    {name: 'Nationale feestdag + Midherfst', start: '2025-10-01', end: '2025-10-08'},
    {name: 'Nieuwjaar', start: '2026-01-01', end: '2026-01-03'},
    {name: 'Lentefestival', start: '2026-02-15', end: '2026-02-23'},
    {name: 'Qingming', start: '2026-04-04', end: '2026-04-06'},
    {name: 'Arbeid', start: '2026-05-01', end: '2026-05-05'},
    {name: 'Drakenboot', start: '2026-06-19', end: '2026-06-21'},
    {name: 'Midherfst', start: '2026-09-25', end: '2026-09-27'},
    {name: 'Nationale feestdag', start: '2026-10-01', end: '2026-10-07'},
];

const HOLIDAY_URL = year =>
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`;

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
        this._notifiedStale = false;
        this._fetching = false;

        this._loadCachedHolidays();

        this._label = new St.Label({
            text: '⚡ ...',
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

        const holiday = this._holidayName(now);
        const peak = this._isPeak(now);
        const stale = this._isStale(now);

        this._label.text = peak
            ? '⚡ PEAK'
            : '⚡ OFF-PEAK';

        if (stale && !this._notifiedStale) {
            this._notifiedStale = true;
            this._notify(
                'Feestdagenlijst is verlopen. Open het menu om bij te werken.'
            );
        }

        this._updateMenu(now, peak, holiday, stale);
    }

    _isPeak(now) {
        const day = now.getUTCDay();
        const hour = now.getUTCHours();

        // Monday-Friday
        if (day < 1 || day > 5)
            return false;

        // Chinese public holidays are fully off-peak.
        if (this._holidayName(now) !== null)
            return false;

        return PEAK_PERIODS.some(period =>
            hour >= period.start &&
            hour < period.end
        );
    }

    _holidayName(now) {
        const date = now.toISOString().slice(0, 10);

        const holiday = this._holidays.find(
            h => date >= h.start && date <= h.end
        );

        return holiday ? holiday.name : null;
    }

    _lastHolidayEnd() {
        return this._holidays.reduce(
            (max, h) => (h.end > max ? h.end : max),
            ''
        );
    }

    _isStale(now) {
        const last = this._lastHolidayEnd();

        return last !== '' &&
            now.toISOString().slice(0, 10) > last;
    }

    _loadCachedHolidays() {
        const file = Gio.File.new_for_path(CACHE_PATH);

        if (!file.query_exists(null))
            return;

        try {
            const [, contents] = file.load_contents(null);
            const data = JSON.parse(new TextDecoder().decode(contents));

            if (Array.isArray(data.holidays))
                this._holidays = this._merge(this._holidays, data.holidays);
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
                JSON.stringify({holidays: this._holidays}, null, 2)
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

    _merge(base, extra) {
        const seen = new Set(base.map(h => h.start));

        return [...base, ...extra.filter(h => !seen.has(h.start))];
    }

    _fetchHolidays() {
        if (this._fetching)
            return;

        this._fetching = true;

        const nowYear = new Date().getUTCFullYear();
        const lastYear = Number(this._lastHolidayEnd().slice(0, 4)) || nowYear;

        const years = [];
        for (let year = lastYear; year <= nowYear + 1; year++)
            years.push(year);

        const session = new Soup.Session();
        this._session = session;

        const found = [];
        let pending = years.length;
        let failed = false;

        years.forEach(year => {
            const message = Soup.Message.new('GET', HOLIDAY_URL(year));

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (sess, result) => {
                    try {
                        const bytes = sess.send_and_read_finish(result);
                        const text = new TextDecoder().decode(bytes.get_data());

                        found.push(...this._parseYear(JSON.parse(text)));
                    } catch (e) {
                        failed = true;
                        logError(e, `deepseek-peak: ${year} ophalen mislukt`);
                    }

                    if (--pending === 0)
                        this._onFetched(found, failed);
                }
            );
        });
    }

    _parseYear(data) {
        const days = Array.isArray(data?.days) ? data.days : [];

        return days
            .filter(day => day.isOffDay)
            .map(day => ({
                name: day.name,
                start: day.date,
                end: day.date,
            }));
    }

    _onFetched(found, failed) {
        this._fetching = false;
        this._session = null;

        if (found.length > 0) {
            this._holidays = this._merge(this._holidays, found);
            this._saveCachedHolidays();
        }

        if (this._isStale(new Date())) {
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

    _updateMenu(now, peak, holiday, stale) {
        this.menu.removeAll();

        const status = new PopupMenu.PopupMenuItem(
            peak
                ? '🔴 DeepSeek API: PEAK'
                : '🟢 DeepSeek API: OFF-PEAK',
            {reactive: false}
        );

        this.menu.addMenuItem(status);

        if (holiday) {
            this.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(
                    `Chinese feestdag: ${holiday}`,
                    {reactive: false}
                )
            );
        }

        if (stale) {
            this.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(
                    '⚠️ Feestdagenlijst mogelijk verouderd',
                    {reactive: false}
                )
            );

            const refresh = new PopupMenu.PopupMenuItem(
                'Feestdagen bijwerken'
            );

            refresh.connect('activate', () => this._fetchHolidays());
            this.menu.addMenuItem(refresh);
        }

        this.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem()
        );

        const localTime = now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });

        const utcTime = now.toISOString().slice(11, 16);

        this.menu.addMenuItem(
            new PopupMenu.PopupMenuItem(
                `Lokale tijd: ${localTime}`,
                {reactive: false}
            )
        );

        this.menu.addMenuItem(
            new PopupMenu.PopupMenuItem(
                `UTC: ${utcTime}`,
                {reactive: false}
            )
        );
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
