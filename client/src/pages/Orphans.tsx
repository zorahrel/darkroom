import { useEffect, useMemo, useState } from "react";
import {
  api,
  thumbOrphanUrl,
  thumbRawUrl,
  type Orphan,
  type PhotoListItem,
} from "../api";

export default function OrphansPage() {
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Orphan | null>(null);

  async function refresh() {
    const [o, p] = await Promise.all([api.orphans(), api.listPhotos("all")]);
    setOrphans(o.orphans);
    setPhotos(p.photos);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!active && orphans.length > 0) setActive(orphans[0] ?? null);
  }, [orphans, active]);

  const filteredPhotos = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return photos;
    return photos.filter((p) => p.id.toLowerCase().includes(q));
  }, [photos, search]);

  if (orphans.length === 0) {
    return (
      <div className="py-20 text-center text-neutral-500">
        Nessun orphan da assegnare. ✨
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-neutral-400">
        <span className="text-white font-medium">{orphans.length}</span>{" "}
        generazioni TEST1 da abbinare alla foto originale. Clicca «Associa»
        sulla candidate giusta o «Skip» se non riconosci la foto.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4">
        {/* Orphan list */}
        <aside className="space-y-1 max-h-[80vh] overflow-y-auto pr-1">
          {orphans.map((o) => (
            <button
              key={o.filename}
              onClick={() => setActive(o)}
              className={
                "w-full flex items-center gap-3 p-2 rounded border text-left transition-colors " +
                (active?.filename === o.filename
                  ? "bg-neutral-800 border-neutral-600"
                  : "bg-neutral-900 border-neutral-800 hover:border-neutral-700")
              }
            >
              <img
                src={thumbOrphanUrl(o.filename)}
                className="w-12 h-12 object-cover rounded flex-none"
                alt={o.filename}
              />
              <span className="text-xs font-mono truncate">{o.filename}</span>
            </button>
          ))}
        </aside>

        {/* Active orphan + candidates */}
        <main className="space-y-3">
          {active && (
            <>
              <div className="rounded-lg overflow-hidden border border-neutral-800 bg-black aspect-square max-w-md">
                <img
                  src={thumbOrphanUrl(active.filename)}
                  className="w-full h-full object-contain"
                  alt={active.filename}
                />
              </div>
              <div className="text-xs text-neutral-400 font-mono">
                {active.filename}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await api.skipOrphan(active.filename);
                    await refresh();
                    setActive(null);
                  }}
                  className="text-xs px-3 py-1.5 rounded border border-neutral-700 text-neutral-400 hover:text-white"
                >
                  Skip (non associare)
                </button>
              </div>

              <div className="pt-3 border-t border-neutral-800">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca photo_id (es. IMG_2762)…"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-600"
                />
                <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 max-h-[55vh] overflow-y-auto">
                  {filteredPhotos.map((p) => (
                    <button
                      key={p.id}
                      onClick={async () => {
                        if (
                          !confirm(
                            `Assegna "${active.filename}" come versione di "${p.id}"?`,
                          )
                        )
                          return;
                        await api.assignOrphan(active.filename, p.id);
                        await refresh();
                        setActive(null);
                      }}
                      className="group relative aspect-square rounded overflow-hidden border border-neutral-800 hover:border-blue-500"
                    >
                      <img
                        src={thumbRawUrl(p.id)}
                        className="w-full h-full object-cover"
                        alt={p.id}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[10px] font-mono truncate">
                        {p.id}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
