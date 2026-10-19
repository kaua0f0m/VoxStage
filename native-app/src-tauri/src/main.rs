#![cfg_attr(any(not(debug_assertions), feature = "desktop-standalone"), windows_subsystem = "windows")]

fn main() {
    voxstage_native::run();
}
