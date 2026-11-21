import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installZh } from "./i18n/install";
import "./styles/globals.css";

installZh();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
