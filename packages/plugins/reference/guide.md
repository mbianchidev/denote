# Reference plugin

## Purpose

This development-only plugin proves the Denote plugin contract and lifecycle. It
does not provide a production user feature.

## Enablement and permissions

Enabling requests the Commands permission. The package must be downloaded and
verified before its code loads.

## Usage

The plugin registers a harmless reference command used by host tests.

## Settings

This plugin has no settings.

## Disable behavior

Disabling unregisters the command, unloads the runtime, and deletes the
downloaded package. It does not edit or delete vault content.

## Troubleshooting

If activation fails, Denote reports the error, rolls back registrations, unloads
the runtime, and removes the package.
