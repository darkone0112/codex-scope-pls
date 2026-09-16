# Codex Scope Pls

> Because apparently knowing which project you currently have open was too much context.

Codex Scope Pls is a small VS Code extension that makes the OpenAI Codex extension scope its chat/session history to the workspace you are actually working in.

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
* `thread/list` already supports filtering by `cwd`.

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
    thread/list
       ↓
     cwd filter
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

I am not rebuilding an AI coding assistant because somebody forgot to pass `cwd`.

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

Preferred implementation order:

```text
1. Supported Codex / VS Code API
             ↓
2. Local Codex protocol proxy
             ↓
3. Narrow patch of the Codex extension
```

If a reliable supported interface exists, use it.

If not, prefer a local protocol shim that intercepts relevant `thread/list` requests and injects the active workspace `cwd`.

If that cannot reliably determine the current workspace, the fallback is a tightly controlled patch of the installed Codex extension.

Yes, modifying another extension is ugly.

So is shipping an AI coding assistant that can inspect an entire repository but cannot separate its chat history from the other repositories sitting next to it.

See [`docs/architecture.md`](docs/architecture.md) for the implementation details.

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

Workspace paths are only supplied locally to Codex where required for session filtering.

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

An unlisted version with an unchanged reviewed bundle can proceed. Changed or unknown bundle bytes remain untouched until compatibility is reviewed.

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

### Restoration

A restoration command returns Codex to its verified original state:

```text
Codex Scope Pls: Restore Original Codex Extension
```

No Codex session files are touched during patching or restoration.

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
* `thread/list`;
* workspace handling;
* bundle layout.

Compatibility may occasionally break.

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
