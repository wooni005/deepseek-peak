// Asynchronous Gio file helpers for the GNOME Shell process.
//
// These are kept in a separate module so the callbacks live outside the
// GObject class in extension.js, and so all file IO is asynchronous (the
// review guidelines on extensions.gnome.org discourage synchronous file IO in
// shell code).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function readFileBytesAsync(file) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(null, (source, result) => {
            try {
                resolve(source.load_contents_finish(result)[1]);
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function writeFileBytesAsync(file, bytes) {
    return new Promise((resolve, reject) => {
        file.replace_contents_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (source, result) => {
                try {
                    source.replace_contents_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

export function makeDirectoryAsync(dir) {
    return new Promise((resolve, reject) => {
        dir.make_directory_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (source, result) => {
                try {
                    source.make_directory_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

// Creates a directory and its missing parents, asynchronously.
export async function ensureDirectoryAsync(dir) {
    try {
        await makeDirectoryAsync(dir);
    } catch (e) {
        if (e instanceof GLib.Error &&
            e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            return;

        if (e instanceof GLib.Error &&
            e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            await ensureDirectoryAsync(dir.get_parent());
            await makeDirectoryAsync(dir);
            return;
        }

        throw e;
    }
}
