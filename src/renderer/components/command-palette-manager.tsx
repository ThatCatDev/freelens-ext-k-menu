/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { action, makeObservable, observable } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import { CommandPalette } from "./command-palette";

class CommandPaletteStore {
  @observable accessor isOpen = false;

  constructor() {
    makeObservable(this);
    this.setupGlobalKeyboardListener();
  }

  @action
  open = () => {
    this.isOpen = true;
  };

  @action
  close = () => {
    this.isOpen = false;
  };

  @action
  toggle = () => {
    this.isOpen = !this.isOpen;
  };

  private setupGlobalKeyboardListener() {
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      // Cmd+K or Ctrl+K
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        event.stopPropagation();
        this.toggle();
      }
    });
  }
}

// Singleton instance
const commandPaletteStore = new CommandPaletteStore();

export { commandPaletteStore };

export interface CommandPaletteManagerProps {
  onSubmit?: (value: string) => void;
}

@observer
export class CommandPaletteManager extends React.Component<CommandPaletteManagerProps> {
  private handleSubmit = (value: string) => {
    console.log("[COMMAND-PALETTE] Submitted value:", value);
    this.props.onSubmit?.(value);
  };

  render() {
    return (
      <CommandPalette
        isOpen={commandPaletteStore.isOpen}
        onClose={commandPaletteStore.close}
        onSubmit={this.handleSubmit}
      />
    );
  }
}
