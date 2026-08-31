# Desktop Release Packages

Desktop artifacts are separated by platform so they can be uploaded to GitHub independently.

## Windows

Build on Windows, or run the `Windows desktop build` GitHub Actions workflow:

```bash
pnpm pack:win
```

Upload the release files from the top-level `Windows/` folder:

- `*-setup.exe` - installer for Windows x64
- `*-portable.exe` - portable Windows x64 application
- `*.zip` - unpacked Windows x64 application with an executable inside

An Apple Silicon Mac can generate the Windows ZIP without NSIS:

```bash
pnpm pack:win:zip
```

The Windows installer and portable single-file EXE must be produced by the Windows GitHub Actions workflow or on a Windows computer.

## macOS

Build on an Apple Silicon Mac, or run the `macOS desktop build` GitHub Actions workflow:

```bash
pnpm pack:mac
```

Upload the files from the top-level `macOS/` folder:

- `*.dmg` - macOS Apple Silicon installer image
- `*.zip` - zipped macOS Apple Silicon application

The current macOS package is unsigned. On first launch, use Control-click, choose **Open**, and confirm. Public distribution should add an Apple Developer ID signature and notarization.

## GitHub Upload

Create one GitHub Release for the version, then upload the Windows files from `Windows/` and the macOS files from `macOS/` as separate assets. These top-level folders are local delivery folders and are ignored by Git so large installers do not enter the source repository.
