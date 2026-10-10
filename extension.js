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
    buildMenuModel,
    chinaYear,
} from './pricing.js';

import {
    holidayUrl,
    parseCache,
    parseCalendar,
    recordAttempt,
    recordSuccess,
    serializeCache,
    yearsToFetch,
} from './holidays.js';

import {
    readFileBytesAsync,
    writeFileAtomicAsync,
} from './gio-async.js';

const CACHE_PATH = GLib.build_filenamev([
    GLib.get_user_data_dir(),
    'deepseek-peak',
    'holidays.json',
]);

// How long a single HTTP request may take before it is aborted.
const REQUEST_TIMEOUT_SECONDS = 30;

const HTTP_OK = 200;

// DEBUG: when true, the "Refresh holidays" button is always shown, even when
// the holiday data is up to date, so the manual refresh path can be tested
// without waiting for stale data. Set back to false before releasing.
const DEBUG_ALWAYS_SHOW_REFRESH = true;

// Maps a menu entry role to the item-level CSS class that controls its spacing
// in the popup. Named roles come from buildMenuModel(); unknown roles fall back
// to no extra class.
const TEXT_ITEM_CLASSES = {
    status: 'deepseek-status-row',
    holiday: 'deepseek-workday-row',
    workday: 'deepseek-workday-row',
    peakHours: 'deepseek-peak-row',
    info: 'deepseek-peak-row',
    stale: 'deepseek-stale-row',
};

const DeepSeekIndicator = GObject.registerClass(
class DeepSeekIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'DeepSeek Peak Pricing');

        this._holidays = [];
        this._workdays = [];
        this._years = {};
        this._cacheLoaded = false;
        this._notifiedStale = false;
        this._fetching = false;
        this._session = null;
        this._destroyed = false;

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

        // Load the cache asynchronously: the popup renders immediately with the
        // (empty) default and updates again as soon as the cache is available.
        this._loadCachedHolidays();

        this._update();
    }

    destroy() {
        this._destroyed = true;

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        // Abort any in-flight download; the callbacks notice that `_session` no
        // longer matches and stop without touching the destroyed extension.
        if (this._session) {
            const session = this._session;
            this._session = null;
            this._fetching = false;
            session.abort();
        }

        super.destroy();
    }

    _cacheState() {
        return {
            holidays: this._holidays,
            workdays: this._workdays,
            years: this._years,
        };
    }

    _update() {
        if (this._destroyed)
            return;

        const now = new Date();
        const model = buildMenuModel(now, this._holidays, this._workdays, {
            alwaysShowRefresh: DEBUG_ALWAYS_SHOW_REFRESH,
        });

        this._label.text = model.panelLabel;

        if (model.stale && !this._notifiedStale) {
            this._notifiedStale = true;
            this._notify(
                'Holiday list may be out of date. Open the menu to refresh.'
            );
        } else if (!model.stale) {
            this._notifiedStale = false;
        }

        this._renderMenu(model);
        this._maybeAutoRefresh(now);
    }

    // Starts a (throttled) background refresh when the cache is loaded. Called
    // on every update tick, so a future year that is not published yet is
    // retried on later daily checks while the extension keeps running.
    _maybeAutoRefresh(now = new Date()) {
        if (!this._cacheLoaded || this._fetching)
            return;

        this._fetchHolidays({manual: false, now});
    }

    async _loadCachedHolidays() {
        const file = Gio.File.new_for_path(CACHE_PATH);
        let state = null;

        try {
            const contents = await readFileBytesAsync(file);
            state = parseCache(new TextDecoder().decode(contents));
        } catch (e) {
            // A missing cache file is expected on the first run.
            if (!(e instanceof GLib.Error &&
                    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)))
                logError(e, 'deepseek-peak: failed to read cache');
        }

        // The extension may have been disabled (and the object destroyed) while
        // the cache was being read.
        if (this._destroyed)
            return;

        if (state) {
            this._holidays = state.holidays;
            this._workdays = state.workdays;
            this._years = state.years;
        }

        this._cacheLoaded = true;
        this._update();
    }

    _fetchHolidays({manual = false, now = new Date()} = {}) {
        if (this._fetching) {
            if (manual)
                this._notify('Holiday refresh already in progress.');
            return;
        }

        const years = yearsToFetch(now, this._cacheState(), {manual});

        if (years.length === 0) {
            if (manual)
                this._notify('Holidays are already up to date.');
            return;
        }

        this._fetching = true;

        const session = new Soup.Session();
        session.timeout = REQUEST_TIMEOUT_SECONDS;
        this._session = session;

        const currentChinaYear = chinaYear(now);
        let pending = years.length;
        let metadataChanged = false;
        let currentYearFailed = false;
        let currentYearUpdated = false;
        let unavailable = 0;
        let updatedDays = 0;

        const finish = () => {
            // The extension was disabled while the request was in flight.
            if (this._session !== session)
                return;

            this._fetching = false;
            this._session = null;
            session.abort();

            // Persist even when only the per-year refresh timestamps changed, so
            // an unavailable future year is not re-fetched on every startup.
            if (metadataChanged)
                this._saveCachedHolidays();

            this._update();

            if (!manual)
                return;

            if (currentYearUpdated)
                this._notify(`Holidays updated (${updatedDays} days).`);
            else if (currentYearFailed)
                this._notify('Failed to refresh holidays.');
            else if (unavailable > 0)
                this._notify('No new holidays available yet.');
            else
                this._notify('Holidays are already up to date.');
        };

        for (const year of years) {
            const message = Soup.Message.new('GET', holidayUrl(year));

            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (sess, result) => {
                    if (this._session !== session)
                        return;

                    let parsed = null;
                    let outcome = 'failed';

                    try {
                        const bytes = sess.send_and_read_finish(result);

                        if (message.get_status() !== HTTP_OK)
                            throw new Error(`HTTP ${message.get_status()}`);

                        const data = JSON.parse(
                            new TextDecoder().decode(bytes.get_data())
                        );

                        parsed = parseCalendar(data, year);

                        if (!parsed.valid)
                            throw new Error('invalid calendar data');

                        outcome = parsed.usable ? 'success' : 'unavailable';
                    } catch (e) {
                        outcome = 'failed';
                        logError(e, `deepseek-peak: failed to fetch ${year}`);
                    }

                    if (outcome === 'success') {
                        const next = recordSuccess(
                            this._cacheState(),
                            year,
                            parsed
                        );

                        this._holidays = next.holidays;
                        this._workdays = next.workdays;
                        this._years = next.years;
                        updatedDays += parsed.dayCount;
                        metadataChanged = true;

                        if (year === currentChinaYear) {
                            currentYearUpdated = true;
                            this._notifiedStale = false;
                        }
                    } else if (outcome === 'unavailable' &&
                            year > currentChinaYear) {
                        // A structurally valid but empty response for a future
                        // year: not announced yet. Never overwrite cached data
                        // and never surface an error for it.
                        const next = recordAttempt(this._cacheState(), year);

                        this._years = next.years;
                        metadataChanged = true;
                        unavailable += 1;
                    } else {
                        // A hard failure, or an empty response for the current
                        // year (which is not usable data): keep any cached data
                        // and stop retrying until the next daily check.
                        const next = recordAttempt(this._cacheState(), year);

                        this._years = next.years;
                        metadataChanged = true;

                        if (year === currentChinaYear)
                            currentYearFailed = true;
                    }

                    if (--pending === 0)
                        finish();
                }
            );
        }
    }

    async _saveCachedHolidays() {
        const file = Gio.File.new_for_path(CACHE_PATH);
        const bytes = new TextEncoder().encode(
            serializeCache(this._cacheState())
        );

        try {
            // writeFileAtomicAsync creates the parent directory when needed.
            await writeFileAtomicAsync(file, bytes);
        } catch (e) {
            logError(e, 'deepseek-peak: failed to write cache');
        }
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
                this.menu.addMenuItem(this._buildRefreshItem(entry));
            } else if (entry.role === 'next') {
                this.menu.addMenuItem(this._buildNextItem(entry));
            } else {
                // The stale warning opens the footer group, separated from the
                // schedule above it.
                if (entry.role === 'stale')
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                this.menu.addMenuItem(this._buildTextItem(entry));
            }
        }
    }

    _buildTextItem(entry) {
        const item = new PopupMenu.PopupMenuItem(
            entry.text,
            {reactive: false}
        );

        item.add_style_class_name('deepseek-item');

        const roleClass = TEXT_ITEM_CLASSES[entry.role];

        if (roleClass)
            item.add_style_class_name(roleClass);

        // The schedule summary and the warning are intentionally muted so they
        // stay secondary to the status and the next peak.
        if (entry.role === 'peakHours' || entry.role === 'info' ||
                entry.role === 'stale')
            item.label.add_style_class_name('dim-label');

        if (entry.style) {
            for (const name of entry.style.split(' '))
                item.label.add_style_class_name(name);
        }

        return item;
    }

    _buildNextItem(entry) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });

        item.add_style_class_name('popup-menu-item');
        item.add_style_class_name('deepseek-item');
        item.add_style_class_name('deepseek-next-item');

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        box.add_child(new St.Label({
            text: entry.caption ?? entry.text,
            style_class: 'deepseek-caption dim-label',
        }));
        box.add_child(new St.Label({
            text: entry.value ?? entry.text,
            style_class: 'deepseek-next-value',
        }));

        item.add_child(box);

        return item;
    }

    _buildRefreshItem(entry) {
        const item = new PopupMenu.PopupMenuItem(entry.text);

        item.add_style_class_name('deepseek-button');
        item.label.add_style_class_name('deepseek-button-label');
        item.label.x_expand = true;
        item.connect('activate', () => this._fetchHolidays({manual: true}));

        return item;
    }
});

export default class DeepSeekPeakExtension extends Extension {
    enable() {
        // A previous version left its indicator registered on re-enable; drop
        // any stale instance before adding ours so the role does not conflict.
        const stale = Main.panel.statusArea['deepseek-peak'];

        if (stale)
            stale.destroy();

        this._indicator = new DeepSeekIndicator();

        Main.panel.addToStatusArea(
            'deepseek-peak',
            this._indicator
        );
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
