import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
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

const DeepSeekIndicator = GObject.registerClass(
class DeepSeekIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'DeepSeek Peak Pricing');

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

        this._label.text = peak
            ? '⚡ PEAK'
            : '⚡ OFF-PEAK';

        this._updateMenu(now, peak, holiday);
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

        const holiday = CHINESE_HOLIDAYS.find(
            h => date >= h.start && date <= h.end
        );

        return holiday ? holiday.name : null;
    }

    _updateMenu(now, peak, holiday) {
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
