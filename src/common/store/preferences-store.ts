import { Common } from "@freelensapp/extensions";
import { makeObservable, observable } from "mobx";

export interface KMenuPreferencesModel {
  enabled: boolean;
  keyboardShortcut: string;
}

export class KMenuPreferencesStore extends Common.Store.ExtensionStore<KMenuPreferencesModel> {
  @observable accessor enabled = true;
  @observable accessor keyboardShortcut = "Cmd+K";

  constructor() {
    super({
      configName: "k-menu-preferences-store",
      defaults: {
        enabled: true,
        keyboardShortcut: "Cmd+K",
      },
    });
    console.log("[K-MENU-PREFERENCES-STORE] constructor");
    makeObservable(this);
  }

  fromStore({ enabled, keyboardShortcut }: KMenuPreferencesModel): void {
    console.log(`[K-MENU-PREFERENCES-STORE] Loading: enabled=${enabled}, keyboardShortcut=${keyboardShortcut}`);

    this.enabled = enabled;
    this.keyboardShortcut = keyboardShortcut;
  }

  toJSON(): KMenuPreferencesModel {
    const { enabled, keyboardShortcut } = this;
    console.log(`[K-MENU-PREFERENCES-STORE] Saving: enabled=${enabled}, keyboardShortcut=${keyboardShortcut}`);
    return {
      enabled,
      keyboardShortcut,
    };
  }
}
