import { render } from "preact";
import { App } from "./App";
import { readEmbeddedProject } from "./files";
import { lastOpenedId, loadFromLibrary, store, toast } from "./store";

function start() {
  let embedded = null;
  try {
    embedded = readEmbeddedProject();
  } catch (e) {
    toast(`The project embedded in this file could not be read: ${e instanceof Error ? e.message : e}`, "error");
  }
  if (embedded) {
    // A newer autosave of the same project in this browser wins over the copy inside the file.
    const local = loadFromLibrary(embedded.id);
    if (local && local.savedAt > embedded.savedAt) {
      store.open(local);
      toast("Opened your newer autosaved copy of this project (the copy inside the file is older).", "warn");
    } else store.open(embedded);
  } else {
    const last = lastOpenedId();
    const p = last ? loadFromLibrary(last) : null;
    if (p) store.open(p);
  }
  render(<App />, document.getElementById("app")!);
}

start();
