import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Home from "./pages/Home";
import Gallery from "./pages/Gallery";

// Two entry surfaces, both in the main chunk because they are the two pages
// you start from: the home (the tools) and a project's grid. The others —
// per-photo editor, orphans, studio — are code-split, so their heavy
// dependencies (StepEditor, PromptBuilder, masks) do not weigh on the first
// paint.
const DetailPage = lazy(() => import("./pages/Detail"));
const OrphansPage = lazy(() => import("./pages/Orphans"));
const StudioPage = lazy(() => import("./pages/Studio"));
const StoryboardPage = lazy(() => import("./pages/Storyboard"));
const SourcesPage = lazy(() => import("./pages/Sources"));
const VideoPage = lazy(() => import("./pages/Video"));
const VideoPick = lazy(() => import("./pages/VideoPick"));
// The pick view: as heavy as the grid, so code-split like the others.
const TreePage = lazy(() => import("./pages/Tree"));
const ReferencesPage = lazy(() => import("./pages/References"));

function PageFallback() {
  return <div className="p-6 text-neutral-400 text-sm">Carico…</div>;
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Home />} />
          <Route path="tools" element={<Home />} />
          <Route
            path="studio"
            element={
              <Suspense fallback={<PageFallback />}>
                <StudioPage />
              </Suspense>
            }
          />
          <Route path="p/:pid" element={<Gallery />} />
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
            path="p/:pid/video"
            element={
              <Suspense fallback={<PageFallback />}>
                <VideoPage />
              </Suspense>
            }
          />
          <Route
            path="p/:pid/video/pick"
            element={
              <Suspense fallback={<PageFallback />}>
                <VideoPick />
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
            path="p/:pid/references"
            element={
              <Suspense fallback={<PageFallback />}>
                <ReferencesPage />
              </Suspense>
            }
          />
          <Route
            path="p/:pid/tree"
            element={
              <Suspense fallback={<PageFallback />}>
                <TreePage />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
