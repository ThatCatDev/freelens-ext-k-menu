import { Main } from "@freelensapp/extensions";
import { StoreLoaderService } from "./services/store-loader";

export default class KMenuMain extends Main.LensExtension {
  async onActivate() {
    await StoreLoaderService.loadStores(this);
  }
}
