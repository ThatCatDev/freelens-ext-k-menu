# Development Scripts

This directory contains helper scripts for developing and testing the Freelens extension.

## Scripts

### `dev-watch.sh` - Development Watch Mode

**Usage:** `pnpm dev` or `./scripts/dev-watch.sh`

**What it does:**
1. Builds the extension
2. Creates a symlink from `~/Library/Application Support/Freelens/node_modules/@thatcatdev/k-menu` to your project directory
3. Registers the extension in Freelens's `lens-extensions.json`
4. Starts watch mode to automatically rebuild on file changes

**Workflow:**
- Make code changes
- Wait for build to complete (watch mode detects changes automatically)
- Restart Freelens to see changes

**Benefits:**
- No need to manually copy files
- Fastest iteration cycle for development
- Changes are automatically built

### `install-to-freelens.sh` - One-Time Install

**Usage:** `pnpm install:freelens` or `./scripts/install-to-freelens.sh`

**What it does:**
1. Builds the extension
2. Copies the entire project to `~/Library/Application Support/Freelens/node_modules/@thatcatdev/k-menu`
3. Registers the extension in Freelens's `lens-extensions.json`

**When to use:**
- Testing a specific build without watch mode
- Creating a stable installation for testing
- When you don't need automatic rebuilds

## How Freelens Loads Extensions

Freelens uses a two-level structure for extensions:

1. **Extensions directory** (the actual extension files):
   - `~/.freelens/extensions/` (macOS/Linux)
   - `%USERPROFILE%/.freelens/extensions/` (Windows)

2. **Node modules symlinks** (symlinks pointing to extensions):
   - `~/Library/Application Support/Freelens/node_modules/@scope/name` (macOS)
   - `~/.config/Freelens/node_modules/@scope/name` (Linux)
   - `%APPDATA%/Freelens/node_modules/@scope/name` (Windows)

Extensions are registered in `lens-extensions.json` which contains an array of:
```json
[
  "/path/to/node_modules/@scope/extension-name/package.json",
  {
    "enabled": true,
    "name": "@scope/extension-name"
  }
]
```

The extension folder name in `~/.freelens/extensions/` uses the format: `scope--name` (double dash instead of slash).

## Troubleshooting

**Extension not appearing:**
1. Check if extension exists: `ls -la ~/.freelens/extensions/thatcatdev--k-menu`
2. Check if symlink exists: `ls -la "$HOME/Library/Application Support/Freelens/node_modules/@thatcatdev/k-menu"`
3. Verify registration: `cat "$HOME/Library/Application Support/Freelens/lens-extensions.json"`
4. Check Freelens logs: `tail -100 ~/Library/Logs/Freelens/lens.log | grep -i k-menu`
5. Restart Freelens completely (quit and reopen, not just Cmd+R)

**Changes not reflected:**
1. Check that build completed successfully
2. Restart Freelens (Cmd+R / Ctrl+R)
3. Check Freelens developer console for errors

**Build errors in watch mode:**
- Fix the error and save - watch mode will automatically retry
- If stuck, kill the process and run `pnpm dev` again
