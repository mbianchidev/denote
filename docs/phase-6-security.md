# Sensitive plugin security design

This is the pre-implementation design for the optional Speech and Encrypted
credential store capabilities. Both are disabled by default. Release requires
the negative tests and platform checks below, not merely a successful build.

## Trust and privacy boundaries

Downloaded workers register bounded host-rendered tools. They receive no
microphone, audio, transcript, credential entry, password, key, clipboard value,
absolute vault path, filesystem handle, or native library handle. Approval of a
tool is not approval to record, download a model, reveal, copy, or export.
Those are separate explicit actions in trusted host controls.

Native operations check the enabled plugin permission, active vault, unlock
state, and opaque operation/session identity. Vault switch, vault lock, plugin
withdrawal, application deactivation, and exit invalidate sensitive work.
Late replies cannot restore an old view or insert content into another note.
General plugin storage, settings exports, note events, network APIs, search,
revisions, autosave, support reports, and logging never receive credential data.

The threat model protects against a stolen closed vault, unauthenticated
credential access, corrupted or hostile input files, stale operations,
downloaded plugin code, and accidental plaintext persistence by Denote.
It does not protect an unlocked session from a compromised OS, debugger,
malicious trusted renderer, screen capture, clipboard manager, input method,
swap, hibernation image, or externally generated crash dump. JavaScript strings
and operating-system clipboard copies cannot be reliably zeroized. These are
explicit residual risks, not claims of cryptographic proof. Denote does not
install a crash reporter or transmit sensitive diagnostics.

## Credential container and cryptographic review

The sole credential file is `.denote/credentials.dncred`. All entry IDs,
service names, usernames, URLs, notes, secrets, and timestamps are inside its
authenticated ciphertext. The fixed filename, format version, random salt,
random nonce, and padded ciphertext length are public. Length reveals a size
bucket, not an entry count. General file and index APIs refuse `.denote` paths.
Whole-vault encryption may additionally wrap this already encrypted container;
turning whole-vault encryption off must never decrypt its inner contents.

Use the existing reviewed RustCrypto Argon2id and XChaCha20-Poly1305 libraries.
Do not implement either primitive. Format version 1 fixes Argon2id version 0x13,
64 MiB memory, three iterations, one lane, a 128-bit random salt, and a 256-bit
key. Passwords require at least 12 characters. Reject oversized passwords and
unknown headers before KDF work; imported files cannot choose unbounded KDF
parameters. There is no password verifier outside the ciphertext.

Authenticate the complete format header as associated data. A fresh 192-bit
nonce is generated for every replacement, including an unchanged document.
Serialize a closed, bounded schema, then pad its length-prefixed contents to a
4 KiB boundary before encryption. Never reuse the vault-encryption key, a
plugin keychain key, or an encryption domain from another feature.
Authentication failures disclose neither metadata nor a partial document.
They must not create, truncate, reset, repair, or replace a file.

Native decrypted buffers, entry strings, passwords, and derived keys use
zeroizing ownership and are not `Debug`. The native session retains a key and
expected ciphertext hash, not a decrypted database. Read each operation under
the existing vault/sidecar locks and reject external replacement. Persist only
ciphertext, with atomic replacement and symlink/reparse-point checks. Any
temporary or recovery file produced by that replacement contains ciphertext.
The host never passes credential contents to the note writer, revision
database, search worker, plugin worker, or diagnostic collector.

Native result/entry buffers also use zeroizing ownership where the IPC API
permits it. Renderer strings and IPC/OS-managed copies remain subject to the
residual memory risks above. Inactivity combines monotonic and wall-clock
deadlines so sleep or a wall-clock adjustment cannot extend native key access.

Create, unlock, list/search/sort, edit, delete, reveal, and copy are separate
actions. Listing never returns secrets. Editing may keep an existing secret
without revealing it. Reveal expires automatically; locking destroys its DOM
and input values. Native inactivity expiry remains authoritative even if the
renderer stops scheduling timers. UI updates and background polling are not
user activity. Focus loss hides/locks sensitive views.

Copy resolves the selected field natively. It returns no value to the
renderer and schedules a bounded clipboard expiry. Clear only when clipboard
contents still match the value Denote copied; do not erase newer user content.
Report clipboard errors using fixed messages. Communicate that clipboard
history and other applications can retain a copy.

Encrypted backup contains only the container ciphertext and remains usable
after removal of the plugin. Import validates format, bounds, authentication,
and ownership before replacement. Replacing an existing store additionally
requires an unlocked current store, current-master reauthentication, explicit
confirmation, and the expected current hash. Wrong passwords, cancellation,
and conflicts leave both files unchanged. Forgotten master passwords cannot be
recovered. No keychain remembrance or recovery backdoor is enabled implicitly.

Plaintext export is a distinct, dangerous native operation. Require the current
master password again and an explicit confirmation for every export. Do not
cache authorization or return exported contents to JavaScript. Revalidate
scope, permission, session expiry, and current ciphertext after the native save
picker closes. Export only to a newly created regular file outside all known
vaults and application storage. Unix creates the file with mode `0600`.
Windows supplies the protected owner-rights DACL in `SECURITY_ATTRIBUTES` to
`CreateFileW` with `CREATE_NEW` and zero sharing. There is no inherited-permission
window in which another account can retain a read handle; readers remain denied
until writing finishes, and the private DACL persists after close. The writer
does not request `WRITE_DAC`. Do not retry with broader permissions or omit
protection on failure. Verify Unix mode bits and Windows persistent-ACL support
before writing; unsupported filesystems/platforms reject private transfers and
remove the empty output. Use no plaintext staging file.
Remove a partial output on failure and report a cleanup failure
without including contents. The confirmed export is intentionally plaintext
and outside subsequent Denote cleanup.

## Speech, recording, and model execution

Implement local operating-system text-to-speech and local audio playback before
microphone recording/dictation, then local transcription and review. Restrict
TTS to voices explicitly identified as local; never silently use remote speech
recognition or synthesis.

Microphone permission is requested only from Start recording or Start dictation.
Keep a written recording/paused indicator, elapsed time, input-level indicator,
and named keyboard-operable stop/cancel controls visible for the full capture.
Escape stops capture even while a control is focused. Pause does not stop being
visible. End every media track and close every audio context on completion,
cancel, error, lock, switch, close, or plugin withdrawal. Reject permission
results that arrive after cancellation.

Record and decode bounded audio in memory. Attach only after explicit finish
and successful collision-safe host storage through the ordinary vault
encryption boundary. Commit the relative Markdown link only to its captured
note and editor position. A failed or stale insertion rolls back the newly
created attachment using its opaque identity and hash, never a caller-selected
path. Cancelled or failed work does not leave a recording.
Recovery authority lives in the application's private SQLite operation table,
not unauthenticated JSON inside a possibly untrusted vault. It stores paths,
identities, and hashes only. Current failed operations can roll back their own
known bytes; uncertain crash recovery preserves completed audio rather than
guessing that another note does not reference it. Its explicit keep-files
recovery action clears only derived metadata. Ordinary notes remain available
when optional recovery needs attention.
Audio links remain standard Markdown when disabled. Inline players must retain
the ordinary link and expose play/pause, seek, volume, speed, and download.
Blob URLs and decrypted playback bytes are revoked/cleared at teardown.

The reviewed current multilingual model is
[NVIDIA Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b),
revision `ea30d66debe3740a08b573244286791d423d6b3e`.
Its Q8 GGUF is 742,090,464 bytes, SHA-256
`3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1`.
It supports 32 out-of-box locales; eight additional adaptation-ready locales
require fine-tuning. Do not describe those eight as ready transcription.

Use the official
[NeMo-Speech.cpp 0.2.0 native C ABI](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.2.0/docs/sdk.md).
Pin platform archives by exact size and SHA-256 from the official release.
No install script, mutable latest URL, arbitrary executable, custom model code,
remote inference endpoint, or runtime dependency install is permitted.
Download approval names the model/runtime, license, download size, and origin.
HTTPS redirects are limited to the upstream release/model CDN hosts.
Downloads are bounded, cancellable, streamed to private staging, verified
before installation, and cleaned up on failure. Revalidate installed code
against the pinned archive before execution.

The native engine receives local model paths and mono float32 audio through
anonymous pipes in an isolated Denote helper process. No audio/transcript file
or HTTP listener is needed. A separate `denote-speech-worker` executable has no
GUI startup path and does not open a vault database, plugin runtime, keychain, or
application window. The desktop executable cannot dispatch inference.
On macOS, only the separately signed nested helper has the
`com.apple.security.cs.disable-library-validation` entitlement required to load
NVIDIA's verified third-party libraries. The main app and credential-store
process retain library validation. The helper has no microphone entitlement;
the main app declares only audio-input access, still gated by an explicit
recording action and OS consent. Helper signing reuses Tauri's configured
identity/certificate handling, and final application notarization covers nested
code. See Apple's [library-validation
requirements](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)
and [audio-input
entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input).
Bound pipe input/output and inference duration. Cancel, withdrawal, and lock
terminate and reap that exact helper process. Native errors are fixed
categories; do not forward engine diagnostics, audio, or transcript text to
logs/support reports. Disable core dumps where supported; OS dumps remain a
documented residual risk.

Transcription is local only. It never writes into an editor automatically.
Keep an editable review draft with Insert transcript and Discard. Optional
timestamps may be offered only when the engine returned validated timing data;
speaker labels require a separately approved diarization model, not invented
labels. Unsupported formats, missing models, partial failures, cancellation,
and unsupported platforms are written recoverable states. Never silently
substitute a remote engine.

## Failure recovery and platform release gates

All automated fixtures use invented data. Required negative coverage includes
wrong passwords, header/ciphertext/tag tampering, malformed schemas, oversized
files/KDF inputs, stale hashes/sessions, symlink/reparse-point paths, locked
vaults, revoked permissions, clipboard replacement, expired exports, import
cancellation, model/archive corruption, archive traversal, failed downloads,
late microphone grants, failed recording insertion, and late transcription.
Scan all generated vault, database, cache, revision, temporary, and diagnostic
artifacts for synthetic credential canaries. Exclude only the explicitly
confirmed plaintext export. Verify inner encryption survives whole-vault
enable/unlock/disable sweeps and plugin data/code removal.

Keyboard-only browser journeys cover formatting, comment orphan recovery,
malformed presentation metadata, slide reordering, speech, transcript review,
and credential forms. Source-preservation assertions compare exact unrelated
bytes, including frontmatter, references, extended syntax, CRLF, and whitespace.

Before release, run native and frontend checks on macOS, Windows, and Linux,
including the existing Windows packaged renderer/shutdown gate. Exercise a
real approved model on synthetic audio, unavailable devices/voices, denied and
revoked microphone permission, sleep/backgrounding, application exit, lock
and switch during work, and encrypted recording playback. Physical microphone,
screen-reader, clipboard-history, and suspend/resume checks require actual
platform evidence. A mocked browser or macOS build is not evidence that those
checks passed on Windows or Linux.
