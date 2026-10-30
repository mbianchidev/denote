fn main() {
    std::process::exit(denote_lib::run_speech_helper_if_requested().unwrap_or(64));
}
