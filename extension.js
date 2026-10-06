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

        const peak = this._isPeak(now);

        this._label.text = peak
            ? '⚡ PEAK'
            : '⚡ OFF-PEAK';

        this._updateMenu(now, peak);
    }

    _isPeak(now) {
        const day = now.getUTCDay();
        const hour = now.getUTCHours();

        // Monday-Friday
        if (day < 1 || day > 5)
            return false;

        return PEAK_PERIODS.some(period =>
            hour >= period.start &&
            hour < period.end
        );
    }

    _updateMenu(now, peak) {
        this.menu.removeAll();

        const status = new PopupMenu.PopupMenuItem(
            peak
                ? '🔴 DeepSeek API: PEAK'
                : '🟢 DeepSeek API: OFF-PEAK',
            {reactive: false}
        );

        this.menu.addMenuItem(status);

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
