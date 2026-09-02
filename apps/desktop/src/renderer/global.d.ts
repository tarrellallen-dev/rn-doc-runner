import type { RnDocRunnerApi } from "../shared/ipc-contract.js";

declare global {
  interface Window {
    rnDocRunner: RnDocRunnerApi;
    rnDocRunnerFiles: {
      getPathForFile(file: File): string;
    };
  }
}
