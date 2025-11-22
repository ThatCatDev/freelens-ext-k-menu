# K-Menu

A powerful command palette extension for Freelens.

<!-- markdownlint-disable MD013 -->

[![GitHub](https://img.shields.io/github/stars/ThatCatDev/freelens-ext-k-menu?style=flat&label=GitHub%20%E2%AD%90)](https://github.com/ThatCatDev/freelens-ext-k-menu)
[![Release](https://img.shields.io/github/v/release/ThatCatDev/freelens-ext-k-menu?display_name=tag&sort=semver)](https://github.com/ThatCatDev/freelens-ext-k-menu)

<!-- markdownlint-enable MD013 -->

K-Menu provides a fast, keyboard-driven command palette for navigating and managing Kubernetes resources in Freelens.

## Features

- **Quick Navigation**: Jump to any Kubernetes resource view instantly
- **Cluster Switching**: Switch between clusters without leaving your keyboard
- **Fuzzy Search**: Find what you need with space-separated search terms
- **Customizable Shortcuts**: Set your preferred keyboard shortcut
- **Filter Support**: Use filters like `kind:`, `namespace:`, and `node:` to narrow results

## Requirements

- Freelens >= 1.6.0

## Install

To install open Freelens and go to Extensions (`ctrl`+`shift`+`E` or
`cmd`+`shift`+`E`), and install `@thatcatdev/k-menu`.

or:

Use a following URL in the browser:
[freelens://app/extensions/install/%40thatcatdev%2Fk-menu](freelens://app/extensions/install/%40thatcatdev%2Fk-menu)

## Build from the source

You can build the extension using this repository.

### Prerequisites

Use [NVM](https://github.com/nvm-sh/nvm) or
[mise-en-place](https://mise.jdx.dev/) or
[windows-nvm](https://github.com/coreybutler/nvm-windows) to install the
required Node.js version.

From the root of this repository:

```sh
nvm install
# or
mise install
# or
winget install CoreyButler.NVMforWindows
nvm install 22.16.0
nvm use 22.16.0
```

Install Pnpm:

```sh
corepack install
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
# or
winget install pnpm.pnpm
```

### Build extension

```sh
pnpm i
pnpm build
pnpm pack
```

One script to build then pack the extension to test:

```sh
pnpm pack:dev
```

### Install built extension

The tarball for the extension will be placed in the current directory. In
Freelens, navigate to the Extensions list and provide the path to the tarball
to be loaded, or drag and drop the extension tarball into the Freelens window.
After loading for a moment, the extension should appear in the list of enabled
extensions.

### Check code statically

```sh
pnpm lint:check
```

or

```sh
pnpm trunk:check
```

and

```sh
pnpm build
pnpm knip:check
```

### Testing the extension with unpublished Freelens

In Freelens working repository:

```sh
rm -f *.tgz
pnpm i
pnpm build
pnpm pack -r
```

then for extension:

```sh
echo "overrides:" >> pnpm-workspace.yaml
for i in ../freelens/*.tgz; do
  name=$(tar zxOf $i package/package.json | jq -r .name)
  echo "  \"$name\": $i" >> pnpm-workspace.yaml
done

pnpm clean:node_modules
pnpm build
```

## License

Copyright (c) 2025 Freelens Authors.

[MIT License](https://opensource.org/licenses/MIT)
