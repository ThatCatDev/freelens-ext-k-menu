import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { KMenuPreferencesStore } from "../../common/store";

const {
  Component: { Checkbox },
} = Renderer;

const preferences = KMenuPreferencesStore.getInstanceOrCreate<KMenuPreferencesStore>();

export const KMenuPreferenceInput = observer(() => {
  const [isRecording, setIsRecording] = React.useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    // Build the shortcut string from the event
    const modifiers: string[] = [];

    if (e.metaKey) modifiers.push("Cmd");
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");

    // Get the key (ignore modifier keys themselves)
    const key = e.key;
    if (["Meta", "Control", "Alt", "Shift"].includes(key)) {
      return; // Don't save if only modifiers are pressed
    }

    // Format the key nicely
    const formattedKey = key.length === 1 ? key.toUpperCase() : key;
    const shortcut = [...modifiers, formattedKey].join("+");

    console.log(`[K-MENU-PREFERENCES] Keyboard shortcut captured: ${shortcut}`);
    preferences.keyboardShortcut = shortcut;
    setIsRecording(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Checkbox
        label="Enable K-Menu"
        value={preferences.enabled}
        onChange={(v) => {
          console.log(`[K-MENU-PREFERENCES] K-Menu enabled: ${v}`);
          preferences.enabled = v;
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label style={{ fontWeight: 500 }}>Keyboard Shortcut</label>
        <input
          type="text"
          readOnly
          placeholder="Click and press keys..."
          value={isRecording ? "Press keys..." : (preferences.keyboardShortcut || "Cmd+K")}
          onFocus={() => setIsRecording(true)}
          onBlur={() => setIsRecording(false)}
          onKeyDown={handleKeyDown}
          disabled={!preferences.enabled}
          style={{
            padding: "8px 12px",
            borderRadius: "4px",
            border: "1px solid #444",
            backgroundColor: preferences.enabled ? (isRecording ? "#2a2a2a" : "#1a1a1a") : "#0a0a0a",
            color: preferences.enabled ? "#fff" : "#666",
            fontSize: "14px",
            outline: isRecording ? "2px solid #4a9eff" : "none",
            cursor: preferences.enabled ? "pointer" : "not-allowed",
          }}
        />
        <span style={{ fontSize: "12px", color: "#888" }}>
          Click the input and press your desired key combination (e.g., Cmd+K, Ctrl+Shift+P)
        </span>
      </div>
    </div>
  );
});

export const KMenuPreferenceHint = () => (
  <span>
    Configure K-Menu command palette settings. Toggle the palette on/off and customize your keyboard shortcut.
  </span>
);
