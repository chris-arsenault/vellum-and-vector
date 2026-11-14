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
        let output = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("../../packages/engine/dist");
        std::fs::create_dir_all(&output).unwrap();
        println!(
            "cargo:rustc-link-arg-bin=atlas_browser=--emit-tsd={}",
            output.join("atlas_browser.d.ts").display()
        );
    }
}
