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

The patch recognizes four roles, allowing the webview roles to share a file or
occupy separate files:

* `out/extension.js`: workspace/settings metadata, live preference delivery and
  the native session picker's display results.
* Notifications: our display message is consumed after the original webview
  origin and chunk checks.
* Rows: the final chat-row renderer filters only its displayed output.
* History: derived entries are scoped before preview selection, counts, tabs
  and search; optional folder sections wrap rendered rows.

Discovery starts at the external module scripts in `webview/index.html` and follows
parsed local imports and re-exports, including literal dynamic imports. It does not
require `app-initial`, `header` or content-hash filename prefixes. Each import-distance
layer is completed before checking for one recognized instance of every role. Once
all roles are found, deeper optional routes are not traversed. Duplicate recognized
roles in the inspected graph fail closed. Unreferenced files do not select targets.

Reads are confined to installed webview assets, with limits of 20,000 modules,
25 MiB per module and 768 MiB cumulatively. Only candidate modules are retained.
The inspected build contains about 17,600 JavaScript chunks, including translations;
first-time discovery can take tens of seconds. Reapply and restore use the receipt's
verified target files instead of traversing the graph again. Computed imports are
never evaluated; an undiscoverable required role causes refusal.

`workspace` displays rows whose cwd exactly matches a workspace root. Multi-root
windows display the union. Empty windows preserve global local-chat visibility.
Cloud visibility is independent of local mode. Backend lists and pagination
remain unchanged.

New Codex versions do not need a version or full-file hash added to this project.
Acorn parses installed JavaScript locally to recognize the display boundaries,
identifier relationships and compiler-cache layout. Asset filenames and generated
identifiers are discovered from that installation. Unrelated edits elsewhere in
the bundles can pass without a Scope Pls update. If a required structure is
missing or ambiguous, no bundle is changed.

Exact legacy profiles remain available for migration and restoration, including
removal of the retired 0.3.5 submission patch. New structural installations touch
only the files containing the verified roles. One reload is still needed after installing patch
code; subsequent preference changes update the display immediately.

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

Acorn is the only runtime npm dependency, pinned in `package-lock.json` and
included in the VSIX. It parses JavaScript without executing it. Node and VS Code
have no built-in syntax-tree API suitable for validating minified patch targets;
using a parser avoids implementing a JavaScript parser or guessing with regex.
There are no runtime downloads or network clients.

## Safe patching

New release labels, changed full-file hashes and renamed generated identifiers
are allowed when the required display structures still pass validation.
Before changing anything, the extension verifies:

* the local platform and workspace constraints;
* ordinary, unlinked target files and non-symlinked directories;
* exactly one recognized instance of each required role in the inspected startup graph;
* the original message-origin and chunk handling sequence;
* the identifier relationships and cache layout used by each patch;
* every exact replacement count and the generated output's syntax;
* each original backup and any existing installation receipt.

A local `out/extension.js.codex-scope-pls.installation.json` receipt records the
installed Codex version, roles, constrained relative target paths, original SHA-256
values and accepted patched SHA-256 values. Schema 2 supports two to four target
files. Schema 1 receipts from 0.3.9 remain valid for restoration and migrate on reapply. Hashes protect integrity and restoration; fresh
original hashes do not need to appear in a shipped allowlist. Reapply accepts only
those recorded originals or exact patched states. Unknown edits, partial patches,
ambiguous targets or invalid receipts/backups abort before any bundle changes.

Structural compatibility is a narrower guarantee than a complete vendor-file
allowlist: it checks the code we depend on, rather than authenticating an entire
Codex release. A matching structure and valid syntax do not prove all runtime
behavior. Changed integration structures still need review and regression tests.

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

Disabling or uninstalling Codex Scope Pls restores a supported patched Codex bundle automatically and reloads the affected VS Code window. The uninstall hook is a second cleanup path when VS Code finalizes removal on restart. This removes workspace display filtering and cloud hiding, restoring all reviewed files. Every cleanup path verifies the exact recorded bundle hashes and original backups before changing anything. Receipt-based restoration does not depend on the current structural recognizer. An unknown or damaged bundle is left untouched.

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

Version 0.3.7 called the wrong HTML-escape helper when constructing the host
webview metadata, causing the Codex sidebar to fail before its HTML loaded.
Version 0.3.8 uses the helper present in 26.930.61225 and recognizes the
0.3.7 host patch for verified replacement or restoration. Reload VS Code
after updating so the extension host reads the repaired file.

Downgrading Codex Scope Pls does not restore modified Codex files: an older
release can refuse hashes written by a newer release. Use **Restore Original
Codex Extension** from version 0.3.6 or newer for a known 0.3.5 installation,
then reload every affected window. Its original backup for the fourth asset
must exist.

Version 0.3.10 supports the inspected 26.1021.22027 layout, with separate
notification and row modules. It also supports that header's `conversationId`
identity field, active remote chat expression and progress identity queries.
Progress counts resolve cwd from the already loaded conversation summaries;
backend queries and their results remain unchanged.

Version 0.3.11 adds the inspected 26.1111.21308 local-only row and history
adapters. Their exact terminal renderer, summary lookup, derived-list hook and
progress identity projection must all match before patching. The display guard
runs after existing hooks. Legacy remote/local adapters remain available.
Warnings show only the first three candidate failures plus the remaining count.

## Compatibility monitoring

The daily Marketplace watcher follows the same import graph and uses the same
structural recognizer as the installed extension. A recognized new release is reported as compatible without adding hashes,
creating a compatibility PR or publishing another Scope Pls release. A failed
structural check opens one deduplicated compatibility issue with the failure reason.
Download failures fail the workflow rather than being presented as incompatibility.
Downloaded vendor code is never executed.

Failing structural or integrity checks leaves Codex untouched. A temporary loss of
workspace filtering is preferable to breaking Codex. Updates that change a required
integration point still require a focused compatibility fix.

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

Install the pinned dependency:

```bash
npm ci
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
