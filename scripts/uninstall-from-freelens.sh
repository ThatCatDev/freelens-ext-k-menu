#!/bin/bash
set -e

# Script to uninstall extension from Freelens
FREELENS_DIR="$HOME/Library/Application Support/Freelens"
FREELENS_EXTENSIONS_DIR="$HOME/.freelens/extensions"

# Read extension name from package.json
EXTENSION_NAME=$(node -p "require('./package.json').name")
# Convert @scope/name to scope--name for folder structure
EXTENSION_FOLDER_NAME=$(echo "$EXTENSION_NAME" | sed 's/@//' | sed 's/\/\/*/--/g')
EXTENSION_REAL_PATH="$FREELENS_EXTENSIONS_DIR/$EXTENSION_FOLDER_NAME"
EXTENSION_SYMLINK_PATH="$FREELENS_DIR/node_modules/$EXTENSION_NAME"

echo "🗑️  Uninstalling extension from Freelens..."

# Remove the symlink in node_modules
if [ -L "$EXTENSION_SYMLINK_PATH" ]; then
    echo "🔗 Removing symlink in node_modules..."
    rm "$EXTENSION_SYMLINK_PATH"
elif [ -d "$EXTENSION_SYMLINK_PATH" ]; then
    echo "📁 Removing directory in node_modules..."
    rm -rf "$EXTENSION_SYMLINK_PATH"
fi

# Remove the extension from ~/.freelens/extensions
if [ -L "$EXTENSION_REAL_PATH" ]; then
    echo "🔗 Removing symlink in ~/.freelens/extensions..."
    rm "$EXTENSION_REAL_PATH"
elif [ -d "$EXTENSION_REAL_PATH" ]; then
    echo "📁 Removing extension directory in ~/.freelens/extensions..."
    rm -rf "$EXTENSION_REAL_PATH"
fi

# Remove from lens-extensions.json
EXTENSIONS_JSON="$FREELENS_DIR/lens-extensions.json"
if grep -q "\"$EXTENSION_NAME\"" "$EXTENSIONS_JSON" 2>/dev/null; then
    echo "📝 Removing from Freelens registry..."
    # Use node to safely update the JSON
    node -e "
        const fs = require('fs');
        const path = '$EXTENSIONS_JSON';
        const data = JSON.parse(fs.readFileSync(path, 'utf8'));
        data.extensions = data.extensions.filter(e => e[1].name !== '$EXTENSION_NAME');
        fs.writeFileSync(path, JSON.stringify(data, null, '\t'));
    "
fi

echo "✅ Extension uninstalled!"
echo "⚠️  Please restart Freelens for changes to take effect"
