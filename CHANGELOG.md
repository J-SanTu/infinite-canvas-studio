# Changelog

## v0.2.0-local

- Reworked the product as a single-user local desktop workspace with no login, employee, role, tenant, or administrator flow.
- Added independent encrypted local API settings for image, text, video, audio, and music providers.
- Made the Node service serve the production `dist` application and `/api` from one process.
- Added Electron desktop startup, Windows installer/portable targets, and macOS/Windows source launchers.
- Separated Windows and macOS release artifacts, checksums, build commands, and GitHub Actions workflows.
- Migrated legacy ownership records into the one local workspace while preserving projects, assets, prompts, and task history.
- Replaced multi-user tests and documentation with local-workspace release rules.

## v0.1.1

- Replaced the dense dark README artwork with a restrained Japanese editorial visual system.
- Added matching English and Simplified Chinese hero/workflow visuals and README pages.

## v0.1.0-santu

- Initial public Santu Infinite Canvas release.
- Included the canvas, media workflows, multi-user administration, usage reports, and Santu-branded Director workspace.
- This architecture was replaced by the local desktop model in v0.2.0-local.
