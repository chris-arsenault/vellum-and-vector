fn main() {
    println!("cargo:rerun-if-changed=src/browser_filesystem.c");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("emscripten") {
        let objects = cc::Build::new()
            .file("src/browser_filesystem.c")
            .compile_intermediates();
        for object in objects {
            println!(
                "cargo:rustc-link-arg-bin=atlas_browser={}",
                object.display()
            );
        }
        // Keep all browser outputs in Cargo's cached target directory. Cargo
        // nests OUT_DIR below <target>/<profile>/build.
        let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let output = out_dir
            .ancestors()
            .find(|path| path.file_name().is_some_and(|name| name == "build"))
            .and_then(std::path::Path::parent)
            .expect("Cargo build output directory");
        println!(
            "cargo:rustc-link-arg-bin=atlas_browser=--emit-tsd={}",
            output.join("atlas_browser.d.ts").display()
        );
    }
}
