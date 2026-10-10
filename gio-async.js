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

export function moveFileAsync(file, destination) {
    return new Promise((resolve, reject) => {
        file.move_async(
            destination,
            Gio.FileCopyFlags.OVERWRITE,
            GLib.PRIORITY_DEFAULT,
            null,
            null,
            (source, result) => {
                try {
                    source.move_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

// Writes `bytes` to a temporary file next to `file` and then renames it over
// the destination, so a reader (or a crash) never sees a half-written cache.
export async function writeFileAtomicAsync(file, bytes) {
    const parent = file.get_parent();

    if (parent)
        await ensureDirectoryAsync(parent);

    const directory = parent ?? file;
    const temp = directory.get_child(`${file.get_basename()}.tmp`);

    await writeFileBytesAsync(temp, bytes);
    await moveFileAsync(temp, file);
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
