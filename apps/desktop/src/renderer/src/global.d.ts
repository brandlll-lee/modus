import type { ModusApi } from "../../../preload/types";

declare global {
  interface Window {
    modus: ModusApi;
  }
}
