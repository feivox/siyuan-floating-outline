[简体中文](README.zh-CN.md)

# Floating Outline

A compact, hover-expandable outline for SiYuan's desktop editor. It follows the active document and marks the heading at the current reading position.

## Features

* Shows heading levels as short markers beside the editor and expands into a readable outline on hover
* Tracks and highlights the heading at the current reading position
* Click a heading to navigate to it, with the selected heading highlighted during the scroll
* Updates when the document or active editor changes, and hides when the editor is unavailable or has no headings

## Requirements

* SiYuan 3.8.5 or later
* SiYuan desktop on Windows, Linux, or macOS

## Install

1. Download the plugin package and extract it to `<workspace>/data/plugins/siyuan-floating-outline`
2. Enable **Floating Outline** in SiYuan's plugin management interface

## Preview and development

For live preview, place the project directory at `<workspace>/data/plugins/siyuan-floating-outline`, then run these commands from that directory:

```sh
pnpm install
pnpm run dev
```

The development build watches `src/index.ts` and `src/index.scss`, and writes `index.js`, `index.css`, and `i18n/` beside `plugin.json`. Enable or reload the plugin in SiYuan to preview changes. If the repository stays outside the workspace, copy those generated files and `plugin.json` into the plugin directory.

## Build

Run the production build to create `package.zip`:

```sh
pnpm run build
```

The package includes the plugin entry files, language files, manifest, and this README.
