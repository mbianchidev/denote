# Reference plugin

## Purpose

This development-only plugin proves the Denote plugin contract and lifecycle. It
does not provide a production user feature.

## Enablement and permissions

Enabling requests Commands, Sidebar, Status, Editor decoration, Note events,
and Secure storage permissions. The package must be downloaded and verified
before its code loads. Secure values use this plugin's isolated operating-system
keychain namespace.

## Usage

The plugin registers one harmless reference command and one explicit keychain
verification command. The verification command writes, reads, and deletes a
synthetic value without accessing any other plugin or Denote credential.
It also adds a small reference sidebar and status item, highlights the literal
word `reference` in source/plain-text editors, and observes note lifecycle
events without reading or changing note content.

## Settings

This plugin has no settings.

## Disable behavior

Disabling unregisters the command, unloads the runtime, and deletes the
downloaded package. It does not edit or delete vault content.

## Troubleshooting

If activation fails, Denote reports the error, rolls back registrations, unloads
the runtime, and removes the package.
