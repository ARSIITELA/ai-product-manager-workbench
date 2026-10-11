---
description: "Simin workbench navigation, document reading, existing conversation slots, detail panels, and theme presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

## Summary

This package provides Simin's personal workbench over real project files and the existing conversation. AppFrame owns viewport measurement, shell overlays, and the floating Agent detail panel; SiminShell owns navigation and reading. The theme presenter projects palette, content font size, and document metadata.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Home uses one sidebar beside a task-focused workspace. The original workbench mark appears with a warm neutral hero, rounded panels, and muted green actions. Six tasks cover initiation reports, PRDs, competitor analysis, AI evaluation, prompt design, and release roadmaps. Project cards and recent documents show real local files and their timestamps, with grid and list views.

A task dialog lets the user choose an existing project or create a named project, add source material, and inspect the deliverable outline. A new project requires source material before creation. Starting a task places a task-specific draft in the existing project conversation; the user sends it to request generation. Initiation drafts prefer the installed ai-initiation-report skill and workspace instructions; missing information is marked TBD. Failed project creation keeps the entered material. Task shortcuts also appear beside project conversations.

Reading and conversation occupy separate rounded panels on wide windows; narrower windows switch between them. Users can copy or download the selected Markdown document. Save proposals display content or line differences before confirmation. File mutations carry the observed content version; conflicts retain the current document. Navigation and display preferences use localStorage; document bodies remain on disk.

Workbench navigation uses a selected set of [Heroicons v2.2.0 solid icons](https://github.com/tailwindlabs/heroicons/tree/v2.2.0/optimized/24/solid); their MIT license is retained in [SiminIcons](src/client/SiminIcons.tsx). Task cards combine shared icons, a deliverable name, and a short task description. Global and project headers retain breadcrumbs, search, and task creation. The sidebar's document entries return to reading.

Workbench settings use flat groups with hairline dividers and monochrome shared switches. Local preferences save immediately; directory copying and the existing model settings dialog remain available through compact row actions.

The root keeps the `main`, `rightbar`, `shell.bottom`, and `shell.overlay` slots. The hidden legacy sidebar keeps its settings portal mounted. Global-panel selection and the existing conversation continue to use `ctx.layout`; the workbench supplies the visible navigation.

<a id="window-chrome-seat"></a>
### Window-chrome seat

The macOS sidebar places the brand below the traffic lights with 48px top padding. Brand and header areas remain draggable; controls remain clickable. The root overlay clearance variables retain the platform titlebar and native-fullscreen behavior. `shell.leading` remains registered for compatibility but is not rendered by this frame.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--dsh-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background. Disposing the presenter removes its metadata node with its other global writes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`selectPanel(id)` validates the live `main` registry. `beginNavigation()` aborts superseded navigation without cancelling underlying Session creation. The root store separates panel selection from viewport and detail-panel measurements. AppFrame measures its own box with ResizeObserver and a cancellable animation frame, and releases both on unmount.

Project opening, draft insertion, conversation search, and model settings use DOM events handled by their existing owners. ui-layout does not value-import ui-workspace. The workbench polls local project data every two seconds with abortable requests; it retains content when reads fail. Existing Agent detail panels render in the floating rightbar slot, which is unavailable below 640px. The independent title component projects the active Session title. Theme updates remain event-driven pure DOM writes.

Project reading and conversation use the theme's base surface inside separate rounded panels. The conversation keeps its existing Session header and gains project task shortcuts above it.

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the layout surface is not enough. They move from the frame to the columns it renders and the theme it presents.

- [ui-sidebar](../ui-sidebar/README.md) — occupies the `sidebar` column and its seats.
- [ui-conversation](../ui-conversation/README.md) — occupies the `main` key `conversation`.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — occupies the `rightbar` column with one docking surface per session.
- [ui-theme](../ui-theme/README.md) — the theme seam whose resolved snapshots the presenter consumes.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the layout exposes no model tools and makes no provider requests.

#### KV Cache effect

Task dialogs prepare localized task instructions and user material as a composer draft. The existing conversation submits that text only when the user sends it, adding input tokens to that conversation; merely opening or preparing a task makes no provider request.

## Known Limitations and Deferred Work

- Project navigation is personal and local; the filesystem root belongs to the Host configuration in this checkout.
- File refresh uses polling; external edits may take up to one polling interval to appear.
- Downloads export Markdown; Word, PDF, and spreadsheet export require a separate generation workflow.
- The workbench does not connect Figma, GitHub, or Feishu, and does not prescribe project stages.
- Windows layout and public distribution are outside this personal Mac build's qualification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
