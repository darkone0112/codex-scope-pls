# Codex Scope Pls

> Because apparently knowing which project you currently have open was too much context.

Codex Scope Pls filters the chat rows displayed in the official Codex GUI to the workspace you are working in. Codex keeps its complete backend lists and sync state.

Open Project A, see Project A conversations.

Open Project B, see Project B conversations.

Do not get one giant flat list containing every conversation from every repo you have touched since installing Codex.

OpenAI can apparently resolve the Navier–Stokes Millennium Problem through some creative aggregation *(stealing)*, achieve AGI every month for the past three years, reason across entire codebases, operate computers, write software, and probably replace half the industry by next Tuesday.

But figuring out:

```text
Which project is currently open in VS Code?
```

was apparently where we hit the frontier.

The especially funny part is that none of the required information is missing:

* VS Code knows the active workspace.
* Codex sessions already store their `cwd`.
* The GUI’s chat summaries already expose their `cwd`.

So this project connects the three dots.

## The problem

The Codex VS Code extension currently treats chat history largely as a global list.

Given:

```text
~/repos/project-a
~/repos/project-b
~/repos/project-c
```

you can end up with something like:

```text
Fix authentication
Refactor API
Why is this broken
Implement ticket merge
Frontend changes
Fix authentication again
Test websocket
...
```

regardless of which repository is currently open.

That works fine until you actually use Codex across more than a couple of projects, at which point the session list turns into digital archaeology.

The missing logic is basically:

```text
current workspace
       ↓
full Codex state
       ↓
GUI-only cwd filter
```

No research breakthrough required.

## Expected behavior

With:

```text
~/repos/project-a
~/repos/project-b
```

opening Project A should show:

```text
Codex Sessions

Project A
├── Implement authentication
├── Fix migration
└── Refactor API
```

Opening Project B should instead show:

```text
Codex Sessions

Project B
├── Build extension
├── Fix sidebar
└── Add tests
```

Not both.

Wild idea, I know.

## Goals

Codex Scope Pls has a deliberately narrow purpose:

* scope Codex session listings to the current VS Code workspace;
* support multi-root workspaces;
* allow temporarily showing all sessions;
* preserve the official Codex UI;
* never modify Codex conversation data;
* remain small enough that the security-sensitive parts can realistically be audited by a human.

This is **not** intended to become a replacement Codex client.

The existing interface only needs a display filter.

## Modes

### Workspace

Only sessions associated with the currently open workspace folder or folders are shown.

```json
{
  "codexScopePls.mode": "workspace"
}
```

### All

Disables filtering and restores the normal global Codex session list.

```json
{
  "codexScopePls.mode": "all"
}
```

Commands:

```text
Codex Scope Pls: Use Current Workspace
Codex Scope Pls: Show All Sessions
```

Mode supports both a global **User** default and a **Workspace** override.
The settings gear opens Workspace settings when a project is open, so changing
Mode there affects that window immediately. **Global Filter Settings** opens the
User defaults. A Workspace value takes precedence: use **Use Global Mode in
This Workspace** to remove it and follow the User default again.

Enable **Codex Scope Pls: Group Chats By Project** (off by default) to add folder
sections to the inline history and Chat history menu while Mode is `all`:

```json
{
  "codexScopePls.mode": "all",
  "codexScopePls.groupChatsByProject": true
}
```

Set it in User settings for a global default or Workspace settings for one
project. Sections use each chat's exact recorded working directory, including
separate sections for subfolders. Full paths distinguish folders with the same
name. Sections follow their most recent displayed chat; rows keep their native
order within each section. Cloud chats and local chats without a working
directory get separate sections. Search, row actions, preview limits and
View all counts remain native. Grouping changes only the displayed loaded rows;
it does not scan folders or fetch additional history.

## Why not build another session manager?

Because the official Codex interface is already there.

Reimplementing the entire chat UI just to filter a list would be absurd.

The goal is to preserve:

```text
Official Codex UI
Official Codex sessions
Official Codex tools
Official Codex behavior
```

and change only:

```text
Which sessions are listed?
```

## Architecture

Version 0.3.6 and later filter presentation only. They leave all app-server and HTTP
requests, responses, complete thread lists, child-agent discovery, queue locks,
IPC notifications and session restoration unchanged.

The reviewed patch modifies exactly three files:

* `out/extension.js`: adds a workspace/settings metadata tag when creating the
  webview, sends preference changes to that view, and filters the native VS Code
  session picker's display results.
* The reviewed `app-initial` asset (`4bd9e54bcd58` or `5120fa5fe295`): filters
  final desktop chat-row output. The older profile also guards the local, cloud,
  pending-start and worktree row components called directly by VS Code's history
  menu. Guards run after existing React hooks. They do not mutate rows,
  summaries or shared lists. A dedicated display notification updates only the
  metadata and its listeners.
* The reviewed `header` asset (`5e09211ec02d` or `901453333583`): scopes
  derived history entries before
  preview selection, totals, in-progress counts, tabs and search. The original
  queries, source arrays, entry objects and native action callbacks stay intact.
  Optional project sections wrap rendered rows in the inline preview and menu.

`workspace` displays rows whose cwd exactly matches one of the workspace roots.
Multi-root windows display the union. Empty windows preserve global local-chat
visibility. **Show Cloud Chats Everywhere** controls cloud row visibility; cloud
requests and their original responses still run normally.

Display settings and roots update the history immediately after a command or
configuration change. One reload is still needed when installing changed patch
code. The three modified files must match their complete hashes and exact patch
points. A fourth asset is checked only to remove the retired 0.3.5 submission
patch when its exact hash and original backup are present. Fresh installations
leave that fourth asset untouched.
The GUI profiles cover the inspected 26.928.31416 / 26.5928.31416 build and
the local 26.930.61225 build. The latter reuses the 26.930.51102 host bytes
but has different webview assets, so the exact package version selects its GUI
profile. Older host records without GUI assets remain available to restore
their known previous patches; they do not enable filtering.
The official Marketplace 26.5930.61225 Linux VSIX has different webview
assets from local 26.930.61225 despite sharing the host hash. It remains a
separate compatibility review.

## Security

Codex Scope Pls is deliberately built with a security-first approach.

The extension interacts with tooling that already has access to source code, so keeping the implementation small, predictable, and auditable matters more than making it clever.

### No telemetry

There is no project telemetry or analytics.

### No external network communication

The extension does not contact:

* project-owned servers;
* analytics providers;
* telemetry services;
* remote configuration endpoints;
* third-party update services.

Workspace paths are used locally to decide which GUI rows to display. They are not added to backend requests.

### No repository scanning

VS Code already knows which workspace is open.

The extension therefore does not crawl your repository to rediscover that information.

This advanced technique is known as:

> not reading files you do not need.

### Minimal dependencies

The target is **zero runtime npm dependencies**.

Where practical, the implementation uses only the VS Code API and built-in Node.js modules.

Fewer dependencies means less code to trust, less code to audit, and fewer supply-chain surprises.

## Safe patching

If modifying the installed Codex extension becomes necessary, the patching system must fail closed.

Before changing anything, it verifies:

* the installed Codex platform and architecture;
* the target file;
* the original SHA-256;
* all expected patch locations;
* the exact match count;
* whether the file is already patched;
* whether the full Codex bundle has a reviewed SHA-256.

If anything is unexpected:

```text
DO NOT PATCH
```

An unlisted version can proceed only when one host profile matches and all of
its GUI assets match the reviewed hashes. If two builds share host bytes, the
installed package version must select exactly one profile. Changed, unknown or
ambiguous files remain untouched until compatibility is reviewed.

A temporary loss of workspace filtering is preferable to breaking Codex.

### Backups

Before modification, a known-good original is retained with version and hash information.

The extension must never replace its only clean backup with an already modified file.

### Atomic writes

Patched content is:

1. generated in memory;
2. validated;
3. written to a temporary file;
4. flushed and closed;
5. atomically moved into place where supported.

All files and their backups are validated under exclusive locks before any
file changes. A replacement failure rolls back changes already made. These files
are not one atomic filesystem transaction: after an interrupted operation,
reapply or restore validates each exact known file state before proceeding.

### Restoration

A restoration command returns Codex to its verified original state:

```text
Codex Scope Pls: Restore Original Codex Extension
```

No Codex session files are touched during patching or restoration.

Disabling or uninstalling Codex Scope Pls restores a supported patched Codex bundle automatically and reloads the affected VS Code window. The uninstall hook is a second cleanup path when VS Code finalizes removal on restart. This removes workspace display filtering and cloud hiding, restoring all reviewed files. Every cleanup path verifies the exact bundle hash and its original backup before changing anything; an unknown or damaged bundle is left untouched rather than guessed at.

### Upgrading from request filtering

Versions before 0.3.0 filtered every backend `thread/list` call and suppressed
cloud list requests. Codex also uses those lists for internal state discovery.
The follow-up failure later recurred with this extension uninstalled and all
Codex files restored, so its current cause remains unverified.
Version 0.3.0 removes those request changes and filters only displayed rows.

Upgrade uses the existing hash-verified host backup to remove the old patch
before enabling GUI filtering. It preserves that backup and creates a separate
verified original backup for the webview asset. Run **Reapply Patch** after
installing if you previously used **Restore Original Codex Extension**, then
reload every window using the installation. Save pending work before reloading.

Version 0.3.0 missed the VS Code history menu: that menu calls the shared row
components directly and bypasses the desktop renderer. Version 0.3.1 covers
those calls and upgrades the known 0.3.0 GUI patch using the same verified
original backup. No backend patch is reintroduced.

Version 0.3.1 still hid rows after the global preview had already selected its
items and calculated totals. Version 0.3.2 scopes the derived UI list first.
It also replaces reload-only preferences with live display notifications, so
workspace/all and cloud visibility commands update the history immediately.

Version 0.3.3 makes Workspace/User mode precedence explicit, opens the relevant
settings tab and adds optional project sections. The verified 0.3.2 patches
migrate using their original backups. Reload once after installing this version
to load the new display code; subsequent preference changes update live.

Version 0.3.3 has a startup regression in its inline history subscription: it
passes Codex's compiler-cache runtime to a React hook. Version 0.3.4 resolves
the actual React namespace through a module-level helper, avoiding the inline
component's shadowing local variable. The incorrect 0.3.3 header hash remains
recognized only for upgrade/restoration with a verified original backup.

Version 0.3.5 added a submission patch that called a missing Codex manager
method and broke Composer submissions. Version 0.3.6 removes that code and
recognizes its exact host and submission-asset hashes for verified restoration.
It applies display filtering to only the same three files as 0.3.4. If Codex
is already restored after uninstall/restart, no further restoration is needed.
Unknown files still fail closed.

Version 0.3.7 adds a GUI profile for the inspected local 26.930.61225 build.
Its host bundle is shared with 26.930.51102, so these profiles use the exact
installed version to select the right GUI assets. The old backend patch data
is retained only for recovery of known prior patched bytes. Display filtering
still touches only the host and two webview files.

Downgrading Codex Scope Pls does not restore modified Codex files: an older
release can refuse hashes written by a newer release. Use **Restore Original
Codex Extension** from version 0.3.6 or newer for a known 0.3.5 installation,
then reload every affected window. Its original backup for the fourth asset
must exist.

## Fail closed

Compatibility logic deliberately prefers:

```text
"This Codex bundle is not compatible yet."
```

over:

```text
"Well, this regex matched something."
```

When OpenAI changes Codex internals, compatibility must be reviewed and tested before a new structure is accepted.

Platform-specific compatibility profiles are kept isolated so those updates remain easy to audit.

## Diagnostics

Diagnostics may include:

```text
Codex Scope Pls version
Codex extension version
Current workspace roots
Selected mode
Target extension path
Target file SHA-256
Patch status
Compatibility status
Last patch/restore result
```

Diagnostics do **not** include:

```text
chat contents
prompts
responses
tokens
credentials
environment-variable dumps
repository contents
```

The diagnostic system, unlike the session list, understands scope.

## Development

Clone the repository:

```bash
git clone https://github.com/<your-user>/codex-scope-pls.git
cd codex-scope-pls
```

Install development dependencies if required:

```bash
npm install
```

Open in VS Code:

```bash
code .
```

Use the standard VS Code Extension Development Host for testing.

## Testing

Security-sensitive logic should be covered by automated tests.

At minimum:

* workspace root calculation;
* multi-root workspaces;
* `workspace` / `all` behavior;
* supported Codex bundle recognition;
* exact patch-match enforcement;
* changed-bundle and unsupported-platform refusal;
* SHA-256 verification;
* backup handling;
* idempotent patching;
* restoration;
* malformed or partially patched targets.

Patch tests operate against fixtures only.

The test suite must never modify the real installed OpenAI extension.

Accidentally patching your editor during `npm test` would be an impressive interpretation of integration testing.

## Building a VSIX

Package with the pinned development tool:

```bash
npm run package
```

Install locally:

```bash
code --install-extension codex-scope-pls-<version>.vsix
```

No Marketplace account is required for local installation.

## Publishing

Marketplace publishing may happen once the extension has been tested against enough Codex versions.

Publishing does not change the security model.

The project should remain:

* small;
* open source;
* auditable;
* dependency-light;
* deterministic;
* explicit about what it modifies;
* reversible;
* boring from a networking perspective.

A verification badge is useful.

Readable code is better.

## Limitations

Codex is actively developed, so OpenAI may change:

* extension internals;
* session APIs;
* GUI rendering boundaries;
* workspace handling;
* bundle layout.

Compatibility may occasionally break. Search results and display surfaces that
do not use the reviewed chat-row renderer remain stock. Backend pagination is
unchanged: use the existing load-more controls to reach older matching chats.
This filter is a viewing convenience, not access control.

The desired failure mode is:

```text
Workspace filtering temporarily stops working.
```

Not:

```text
Codex no longer launches.
```

## The ideal future

The best outcome is that this project becomes unnecessary.

The upstream feature could be approximately:

```text
Codex
  Session scope:
    ● Current workspace
    ○ All workspaces
```

That's it.

That's the feature.

OpenAI can spend billions chasing artificial general intelligence

Surely one of them can eventually discover:

```js
cwd = vscode.workspace.workspaceFolders
```

Until then:

**Codex Scope Pls.**

## Contributing

Keep changes focused.

Prefer:

* small diffs;
* explicit reasoning;
* deterministic behavior;
* tests;
* minimal dependencies;
* fail-closed compatibility handling.

Read [`AGENTS.md`](AGENTS.md) before making substantial changes.

Pull requests implementing a distributed multi-agent consensus protocol for discovering the current folder will be respectfully declined.

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

You are free to use, study, modify, and redistribute this project under the terms of the AGPLv3.

If you modify it and make the modified version available to users over a network, the AGPL requires that those users are offered the corresponding source code.

See [`LICENSE`](LICENSE) for the full license text.

Use it, audit it, fork it, improve it.

And ideally delete it one day because Codex achieved workspace awareness before artificial general intelligence.
