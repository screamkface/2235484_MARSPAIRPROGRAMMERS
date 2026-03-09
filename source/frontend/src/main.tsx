import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// React 19 root mount point for the single-page dashboard application.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />
);
