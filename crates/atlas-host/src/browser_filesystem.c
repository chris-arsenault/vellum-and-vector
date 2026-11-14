#include <emscripten/wasmfs.h>
#include <stdlib.h>

/* Mount the browser's persistent volume before Rust opens its separate catalogs.
 * Scratch outside /atlas remains disposable. All file operations use WasmFS. */
void wasmfs_before_preload(void) {
    backend_t storage = wasmfs_create_opfs_backend();
    if (!storage || wasmfs_create_directory("/atlas", 0700, storage) != 0) {
        abort();
    }
}
