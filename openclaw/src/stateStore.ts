import fs from "node:fs";
import path from "node:path";
import { LocalState } from "./types";

export class StateStore {
  private readonly statePath: string;

  constructor(stateDir: string) {
    this.statePath = path.join(stateDir, "state.json");
  }

  load(): LocalState {
    if (!fs.existsSync(this.statePath)) {
      return { files: {} };
    }
    return JSON.parse(fs.readFileSync(this.statePath, "utf8")) as LocalState;
  }

  save(next: LocalState): void {
    fs.writeFileSync(this.statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
}
