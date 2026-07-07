import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Home from "./pages/Home";
import DetailPage from "./pages/Detail";
import OrphansPage from "./pages/Orphans";
import StudioPage from "./pages/Studio";
import { api, lastProject } from "./api";

// `/` lands on the last-opened project's grid (or the first registered one,
// or the Studio if there are none). Keeps the single-project muscle memory
// while the project now lives in the URL (`/p/:pid`).
function RootRedirect() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    const last = lastProject();
    if (last) {
      setTo(`/p/${encodeURIComponent(last)}`);
      return;
    }
    api
      .studioProjects()
      .then((r) =>
        setTo(r.projects[0] ? `/p/${encodeURIComponent(r.projects[0].id)}` : "/studio"),
      )
      .catch(() => setTo("/studio"));
  }, []);
  if (!to) return null;
  return <Navigate to={to} replace />;
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<RootRedirect />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="p/:pid" element={<Home />} />
          <Route path="p/:pid/photo/:id" element={<DetailPage />} />
          <Route path="p/:pid/orphans" element={<OrphansPage />} />
          <Route path="*" element={<Navigate to="/studio" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
