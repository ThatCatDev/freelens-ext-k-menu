#!/bin/bash
set -e

# Script for development with watch mode and auto-install
FREELENS_DIR="$HOME/Library/Application Support/Freelens"
FREELENS_EXTENSIONS_DIR="$HOME/.freelens/extensions"

# Read extension name from package.json
EXTENSION_NAME=$(node -p "require('./package.json').name")
# Convert @scope/name to scope--name for folder structure
EXTENSION_FOLDER_NAME=$(echo "$EXTENSION_NAME" | sed 's/@//' | sed 's/\/\/*/--/g')
EXTENSION_REAL_PATH="$FREELENS_EXTENSIONS_DIR/$EXTENSION_FOLDER_NAME"
EXTENSION_SYMLINK_PATH="$FREELENS_DIR/node_modules/$EXTENSION_NAME"

echo "🔧 Setting up development watch mode..."

# Initial build
echo "📦 Initial build..."
pnpm build

# Ensure the directory structure exists
mkdir -p "$FREELENS_EXTENSIONS_DIR"
mkdir -p "$(dirname "$EXTENSION_SYMLINK_PATH")"

# Remove existing installation in ~/.freelens/extensions
if [ -L "$EXTENSION_REAL_PATH" ]; then
    echo "🔗 Removing existing symlink in ~/.freelens/extensions..."
    rm "$EXTENSION_REAL_PATH"
elif [ -d "$EXTENSION_REAL_PATH" ]; then
    echo "📁 Removing existing installation in ~/.freelens/extensions..."
    rm -rf "$EXTENSION_REAL_PATH"
fi

# Remove existing symlink in node_modules
if [ -L "$EXTENSION_SYMLINK_PATH" ]; then
    echo "🔗 Removing existing symlink in node_modules..."
    rm "$EXTENSION_SYMLINK_PATH"
elif [ -d "$EXTENSION_SYMLINK_PATH" ]; then
    echo "📁 Removing existing directory in node_modules..."
    rm -rf "$EXTENSION_SYMLINK_PATH"
fi

# Create symlink from ~/.freelens/extensions to project directory
echo "🔗 Creating symlink in ~/.freelens/extensions..."
ln -s "$PWD" "$EXTENSION_REAL_PATH"

# Create symlink from node_modules to ~/.freelens/extensions
echo "🔗 Creating symlink in node_modules..."
ln -s "$EXTENSION_REAL_PATH" "$EXTENSION_SYMLINK_PATH"

# Update lens-extensions.json to enable the extension if not already listed
EXTENSIONS_JSON="$FREELENS_DIR/lens-extensions.json"
if ! grep -q "\"$EXTENSION_NAME\"" "$EXTENSIONS_JSON" 2>/dev/null; then
    echo "📝 Registering extension in Freelens..."
    # Use node to safely update the JSON
    node -e "
        const fs = require('fs');
        const path = '$EXTENSIONS_JSON';
        const data = JSON.parse(fs.readFileSync(path, 'utf8'));
        const newExt = [
            '$EXTENSION_SYMLINK_PATH/package.json',
            { enabled: true, name: '$EXTENSION_NAME' }
        ];
        if (!data.extensions.some(e => e[1].name === '$EXTENSION_NAME')) {
            data.extensions.push(newExt);
            fs.writeFileSync(path, JSON.stringify(data, null, '\t'));
        }
    "
fi

echo "✅ Symlinks created!"
echo "👀 Starting watch mode..."
echo "⚠️  After code changes, restart Freelens to see updates"
echo ""

# Start vite in watch mode
pnpm exec electron-vite build --watch