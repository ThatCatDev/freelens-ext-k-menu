/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import React from "react";
import styles from "./command-palette.module.scss";

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (value: string) => void;
}

@observer
export class CommandPalette extends React.Component<CommandPaletteProps> {
  private inputRef = React.createRef<HTMLInputElement>();
  private backdropRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    if (this.props.isOpen) {
      this.focusInput();
    }
    document.addEventListener("keydown", this.handleGlobalKeyDown);
  }

  componentDidUpdate(prevProps: CommandPaletteProps) {
    if (this.props.isOpen && !prevProps.isOpen) {
      this.focusInput();
    }
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this.handleGlobalKeyDown);
  }

  private focusInput = () => {
    setTimeout(() => {
      this.inputRef.current?.focus();
    }, 10);
  };

  private handleGlobalKeyDown = (event: KeyboardEvent) => {
    // Cmd+K or Ctrl+K to toggle
    if ((event.metaKey || event.ctrlKey) && event.key === "k") {
      event.preventDefault();
      event.stopPropagation();

      if (this.props.isOpen) {
        this.props.onClose();
      } else {
        // This will be handled by the parent component
        // Just prevent default here
      }
    }
  };

  private handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.props.onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const value = this.inputRef.current?.value || "";
      this.props.onSubmit?.(value);
      this.props.onClose();
    }
  };

  private handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === this.backdropRef.current) {
      this.props.onClose();
    }
  };

  render() {
    if (!this.props.isOpen) {
      return null;
    }

    return (
      <div ref={this.backdropRef} className={styles.backdrop} onClick={this.handleBackdropClick}>
        <div className={styles.modal}>
          <div className={styles.searchContainer}>
            <input
              ref={this.inputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Type a command or search..."
              onKeyDown={this.handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className={styles.hint}>
            Press <kbd>Enter</kbd> to execute, <kbd>Esc</kbd> to close
          </div>
        </div>
      </div>
    );
  }
}
