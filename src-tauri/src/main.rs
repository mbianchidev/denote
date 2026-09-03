// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A Git credential prompt reaches Denote as an ordinary process launch.
    // It is answered and the process exits before any window, database, or
    // plugin manager exists.
    if denote_lib::run_askpass_if_requested() {
        return;
    }
    denote_lib::run()
}
