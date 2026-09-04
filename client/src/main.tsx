import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import Home from "./pages/Home";
import Galleria from "./pages/Gallery";

// Due superfici d'ingresso, entrambe nel chunk principale perché sono le due
// pagine da cui si comincia: la home (gli strumenti) e la griglia di un
// progetto. Le altre — editor per foto, orfane, studio — sono code-split, così
// le loro dipendenze pesanti (StepEditor, PromptBuilder, maschere) non pesano
// sul primo disegno.
const DetailPage = lazy(() => import("./pages/Detail"));
const OrphansPage = lazy(() => import("./pages/Orphans"));
const StudioPage = lazy(() => import("./pages/Studio"));
const StoryboardPage = lazy(() => import("./pages/Storyboard"));
const SourcesPage = lazy(() => import("./pages/Sources"));
const VideoPage = lazy(() => import("./pages/Video"));
const VideoPick = lazy(() => import("./pages/VideoPick"));
// La vista di scelta: pesa quanto la griglia, quindi code-split come le altre.
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
          <Route path="strumenti" element={<Home />} />
          <Route
            path="studio"
            element={
              <Suspense fallback={<PageFallback />}>
                <StudioPage />
              </Suspense>
            }
          />
          <Route path="p/:pid" element={<Galleria />} />
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
            path="p/:pid/video/scelta"
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
            path="p/:pid/riferimenti"
            element={
              <Suspense fallback={<PageFallback />}>
                <ReferencesPage />
              </Suspense>
            }
          />
          <Route
            path="p/:pid/albero"
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
