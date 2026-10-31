# Speech, voice notes, and transcription

## Purpose

Read a note aloud, record a voice note, or review a local transcript before
inserting it. Audio and accepted transcripts remain ordinary vault content.

## Enablement and permissions

Disabled by default. The isolated speech permission opens trusted host controls,
not a microphone or file API for plugin code. Only Start recording and Start
dictation request microphone access. No remote speech service is used.
The model and native engine require a separate approved download.

## Usage

Open Speech from the command palette. Choose an installed local voice and use
Read note aloud, Pause speech, Resume speech, and Stop speech. Recordings show
their state, elapsed time, and input level. Escape stops capture; Cancel recording
discards it. Choose Finish recording, review the clip, then Save voice note.
This saves encrypted-at-rest audio when vault encryption is on and inserts a
standard relative Markdown link. Dictation and imported audio
produce an editable transcript draft. Insert transcript is always explicit.

Inline audio retains its ordinary link and supports playback, seek, volume,
speed, and download. Other Markdown applications can open the same audio link.

## Settings

Voice, speech rate, and transcription locale are chosen in the host panel.
The approved local model is NVIDIA Nemotron 3.5 ASR Streaming 0.6B, a 742 MB
download plus a small native runtime. Its license and origin are shown before
download. No GPU is required by the CPU runtime. Nothing downloads on enablement.

## Disable behavior

Turning the plugin off closes speech controls, stops capture and playback,
terminates transcription, clears draft audio/transcripts, and removes plugin
and native runtime code. Existing audio, notes, and accepted transcripts are
never deleted. Audio links remain ordinary links. Downloaded model weights are
reusable public data; their cleanup is separate from
vault content and requires an explicit action.

## Troubleshooting

Unavailable local voices, denied microphones, unsupported formats, missing
models, and failed downloads show recoverable errors. Check OS microphone
privacy settings before retrying. Do not select a remote voice as a workaround.
Locked encrypted vaults cannot record, play decrypted attachments, or transcribe.
No plaintext audio temporary file is used. Other applications, device drivers,
OS memory dumps, and previously downloaded/exported audio are outside this
plugin's cleanup boundary.

Interrupted saves use private host recovery metadata, never vault-supplied
deletion instructions. Uncertain recordings are kept. Unfinished audio recovery
offers Keep unfinished audio to clear only the recovery record while preserving
every file for manual review.
