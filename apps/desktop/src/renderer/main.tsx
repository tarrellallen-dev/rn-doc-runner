import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("root_element_missing");
createRoot(container).render(<App />);
