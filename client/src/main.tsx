import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Home from "./pages/Home";
import { api, lastProject } from "./api";

// Home is the landing surface — keep it in the main chunk so the grid paints
// without a flash. The secondary pages (per-photo editor, orphans, studio) are
// code-split so their heavier deps (StepEditor, PromptBuilder, masks) don't
// weigh down first paint of the grid.
const DetailPage = lazy(() => import("./pages/Detail"));
const OrphansPage = lazy(() => import("./pages/Orphans"));
const StudioPage = lazy(() => import("./pages/Studio"));
const StoryboardPage = lazy(() => import("./pages/Storyboard"));
const SourcesPage = lazy(() => import("./pages/Sources"));

function PageFallback() {
  return <div className="p-6 text-neutral-500 text-sm">Carico…</div>;
}

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
          <Route
            path="studio"
            element={
              <Suspense fallback={<PageFallback />}>
                <StudioPage />
              </Suspense>
            }
          />
          <Route path="p/:pid" element={<Home />} />
          <Route
            path="p/:pid/photo/:id"
            element={
              <Suspense fallback={<PageFallback />}>
                <DetailPage />
              </Suspense>
            }
          />
          <Route
            path="p/:pid/storyboard"
            element={
              <Suspense fallback={<PageFallback />}>
                <StoryboardPage />
              </Suspense>
            }
          />
          <Route
            path="p/:pid/sources"
            element={
              <Suspense fallback={<PageFallback />}>
                <SourcesPage />
              </Suspense>
            }
          />
          <Route
            path="p/:pid/orphans"
            element={
              <Suspense fallback={<PageFallback />}>
                <OrphansPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/studio" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
