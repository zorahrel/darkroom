import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberField, Choose } from "../ui";
import {
  api,
  panelImageUrl,
  thumbRawUrl,
  type Character,
  type Panel,
  type PhotoListItem,
  type StoryboardSettings,
} from "../api";

/**
 * The storyboard: panels in order with their duration, cast and scene labels.
 * Write the beats, let the queue draw them, re-order by dragging, then export
 * to Storyboarder for 3D blocking and print.
 */
export default function StoryboardPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [settings, setSettings] = useState<StoryboardSettings | null>(null);
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a refresh so panel thumbnails re-fetch once a job lands.
  const [imageBust, setImageBust] = useState(() => Date.now());

  // Signature of what the thumbnails actually render, so the cache-buster only
  // moves when a panel row really changed. The board re-polls every 5s while
  // panels are still generating; busting on every poll re-downloaded every
  // thumbnail on the board, over and over, for the whole generation.
  const imageSigRef = useRef("");

  const refresh = useCallback(async () => {
    const board = await api.storyboard();
    setPanels(board.panels);
    setCharacters(board.characters);
    setSettings(board.settings);
    const sig = board.panels
      .map((p) => `${p.id}:${p.updated_at}:${p.image_path ?? ""}`)
      .join("|");
    if (sig !== imageSigRef.current) {
      imageSigRef.current = sig;
      setImageBust(Date.now());
    }
  }, []);

  useEffect(() => {
    Promise.all([refresh(), api.listPhotos("all").then((r) => setPhotos(r.photos))])
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [refresh]);

  // Panels are generated in the background: keep the board fresh while any of
  // them is still waiting for its image.
  useEffect(() => {
    if (!panels.some((p) => !p.image_path)) return;
    const id = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [panels, refresh]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const totalMs = useMemo(
    () => panels.reduce((sum, p) => sum + p.duration_ms, 0),
    [panels],
  );
  const loose = useMemo(() => {
    const inBoard = new Set(panels.map((p) => p.id));
    return photos.filter((p) => !inBoard.has(p.id));
  }, [photos, panels]);

  if (loading) return <div className="p-6 text-neutral-400 text-sm">Carico…</div>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Storyboard</h1>
        <span className="text-sm text-neutral-400">
          {panels.length} pannell{panels.length === 1 ? "o" : "i"} · {formatDuration(totalMs)}
        </span>
        <div className="flex-1" />
        {settings && (
          <BoardSettings
            settings={settings}
            onChange={(patch) => run("settings", () => api.setStoryboardSettings(patch))}
          />
        )}
        <button
          disabled={!panels.length || busy !== null}
          onClick={() =>
            run("export", async () => {
              const res = await api.exportStoryboard();
              const skipped = res.skipped.length
                ? `\n\n${res.skipped.length} pannello/i senza immagine, esclusi.`
                : "";
              alert(`Esportati ${res.boards} pannelli in:\n${res.path}${skipped}`);
            })
          }
          className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 border border-emerald-700 disabled:opacity-50"
        >
          {busy === "export" ? "Esporto…" : "Esporta per Storyboarder"}
        </button>
      </header>

      {error && (
        <div className="text-sm rounded border border-red-900 bg-red-950/50 text-red-200 px-3 py-2">
          {error}
        </div>
      )}

      <BeatSheet
        characters={characters}
        busy={busy === "beats"}
        onSubmit={(beats) => run("beats", () => api.createPanels(beats))}
      />

      {panels.length === 0 ? (
        <div className="py-12 text-center text-neutral-400 text-sm">
          Nessun pannello. Scrivi i beat qui sopra, oppure porta nello storyboard
          delle foto che hai già.
        </div>
      ) : (
        <PanelBoard
          panels={panels}
          characters={characters}
          imageBust={imageBust}
          onReorder={(ids) => run("sequence", () => api.setSequence(ids))}
          onPatch={(id, patch) => run(`panel-${id}`, () => api.updatePanel(id, patch))}
          onRemove={(id) => run(`panel-${id}`, () => api.removePanel(id))}
        />
      )}

      <CastPanel
        characters={characters}
        photos={photos}
        busy={busy === "cast"}
        onSave={(input) => run("cast", () => api.setCharacter(input))}
        onDelete={(id) => run("cast", () => api.deleteCharacter(id))}
      />

      {loose.length > 0 && (
        <AddExisting
          photos={loose}
          busy={busy === "add"}
          onAdd={(ids) => run("add", () => api.addToSequence(ids))}
        />
      )}
    </div>
  );
}

// ---- Beat sheet -------------------------------------------------------------

function BeatSheet({
  characters,
  busy,
  onSubmit,
}: {
  characters: Character[];
  busy: boolean;
  onSubmit: (beats: { description: string; scene_label?: string | null; duration_ms?: number; character_ids?: string[] }[]) => void;
}) {
  const [text, setText] = useState("");
  const [scene, setScene] = useState("");
  const [duration, setDuration] = useState(3000);
  const [cast, setCast] = useState<string[]>([]);

  const beats = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 space-y-3">
      <div className="text-sm font-medium">Nuovi pannelli</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"Un'inquadratura per riga.\nEs: campo lungo sulla strada vuota all'alba\nEs: primo piano sulle sue mani che tremano"}
        className="w-full text-sm bg-neutral-950 border border-neutral-800 rounded px-3 py-2 font-mono resize-y"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-neutral-400 space-y-1">
          <span className="block">Scena</span>
          <input
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            placeholder="INT. BAR - NOTTE"
            className="text-sm bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 w-56"
          />
        </label>
        <label className="text-xs text-neutral-400 space-y-1">
          <span className="block">Durata (ms)</span>
          <NumberField value={duration} onChange={setDuration}
                  min={100} max={600000} step={100} width={112} />
        </label>
        {characters.length > 0 && (
          <div className="text-xs text-neutral-400 space-y-1">
            <span className="block">In scena</span>
            <div className="flex flex-wrap gap-1">
              {characters.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() =>
                    setCast((prev) =>
                      prev.includes(ch.id) ? prev.filter((c) => c !== ch.id) : [...prev, ch.id],
                    )
                  }
                  className={
                    "px-2 py-1 rounded border text-xs transition-colors " +
                    (cast.includes(ch.id)
                      ? "bg-sky-900/60 border-sky-700 text-sky-100"
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white")
                  }
                >
                  {ch.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1" />
        <button
          disabled={!beats.length || busy}
          onClick={() => {
            onSubmit(
              beats.map((description) => ({
                description,
                scene_label: scene.trim() || null,
                duration_ms: duration,
                character_ids: cast,
              })),
            );
            setText("");
          }}
          className="text-sm px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 border border-sky-700 disabled:opacity-50"
        >
          {busy ? "Accodo…" : `Genera ${beats.length || ""} pannell${beats.length === 1 ? "o" : "i"}`}
        </button>
      </div>
    </section>
  );
}

// ---- Board ------------------------------------------------------------------

function PanelBoard({
  panels,
  characters,
  imageBust,
  onReorder,
  onPatch,
  onRemove,
}: {
  panels: Panel[];
  characters: Character[];
  imageBust: number;
  onReorder: (ids: string[]) => void;
  onPatch: (id: string, patch: { duration_ms?: number; scene_label?: string | null; character_ids?: string[] }) => void;
  onRemove: (id: string) => void;
}) {
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function drop(targetId: string) {
    const from = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!from || from === targetId) return;
    const ids = panels.map((p) => p.id).filter((id) => id !== from);
    const at = ids.indexOf(targetId);
    ids.splice(at < 0 ? ids.length : at, 0, from);
    onReorder(ids);
  }

  let elapsed = 0;
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {panels.map((panel, i) => {
        const at = elapsed;
        elapsed += panel.duration_ms;
        return (
          <article
            key={panel.id}
            draggable
            onDragStart={() => {
              dragId.current = panel.id;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverId(panel.id);
            }}
            onDragLeave={() => setOverId((cur) => (cur === panel.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              drop(panel.id);
            }}
            className={
              "rounded-lg border bg-neutral-900/40 overflow-hidden transition-colors " +
              (overId === panel.id ? "border-sky-600" : "border-neutral-800")
            }
          >
            <div className="relative aspect-video bg-neutral-950 flex items-center justify-center">
              {panel.image_path ? (
                <img
                  src={panelImageUrl(panel.id, 640, imageBust)}
                  alt={`Pannello ${i + 1}`}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
              ) : (
                <span className="text-xs text-neutral-400">in generazione…</span>
              )}
              <span className="absolute top-1.5 left-1.5 text-xs px-1.5 py-0.5 rounded bg-black/70 text-neutral-200">
                {i + 1} · {formatDuration(at)}
              </span>
              <button
                onClick={() => onRemove(panel.id)}
                title="Togli dallo storyboard (la foto resta)"
                className="absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded bg-black/70 text-neutral-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>
            <div className="p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  defaultValue={panel.scene_label ?? ""}
                  onBlur={(e) => {
                    const next = e.target.value.trim() || null;
                    if (next !== panel.scene_label) onPatch(panel.id, { scene_label: next });
                  }}
                  placeholder="Scena"
                  className="flex-1 min-w-0 text-xs bg-neutral-950 border border-neutral-800 rounded px-2 py-1"
                />
                <NumberField value={panel.duration_ms} min={100} max={600000} step={100}
                        width={80} title="Durata (ms)"
                        onChange={(ms) => {
                          if (Number.isFinite(ms) && ms > 0 && ms !== panel.duration_ms) {
                            onPatch(panel.id, { duration_ms: ms });
                          }
                        }} />
              </div>
              {characters.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {characters.map((ch) => {
                    const on = panel.character_ids.includes(ch.id);
                    return (
                      <button
                        key={ch.id}
                        onClick={() =>
                          onPatch(panel.id, {
                            character_ids: on
                              ? panel.character_ids.filter((c) => c !== ch.id)
                              : [...panel.character_ids, ch.id],
                          })
                        }
                        className={
                          "px-1.5 py-0.5 rounded border text-[11px] transition-colors " +
                          (on
                            ? "bg-sky-900/60 border-sky-700 text-sky-100"
                            : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white")
                        }
                      >
                        {ch.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

// ---- Cast -------------------------------------------------------------------

function CastPanel({
  characters,
  photos,
  busy,
  onSave,
  onDelete,
}: {
  characters: Character[];
  photos: PhotoListItem[];
  busy: boolean;
  onSave: (input: { name: string; reference_photo_id?: string | null; description?: string | null }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ref, setRef] = useState("");

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 space-y-3">
      <div className="text-sm font-medium">Personaggi</div>
      <p className="text-xs text-neutral-400">
        La foto di riferimento viene allegata a ogni generazione in cui il
        personaggio compare: è ciò che gli tiene la stessa faccia da un pannello
        all'altro.
      </p>

      {characters.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {characters.map((ch) => (
            <li
              key={ch.id}
              className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950 pl-2 pr-1 py-1"
            >
              {ch.reference_photo_id && (
                <img
                  src={thumbRawUrl(ch.reference_photo_id, 64)}
                  alt=""
                  className="w-8 h-8 rounded object-cover"
                />
              )}
              <span className="text-sm">{ch.name}</span>
              {ch.description && (
                <span className="text-xs text-neutral-400">{ch.description}</span>
              )}
              <button
                onClick={() => onDelete(ch.id)}
                title="Elimina personaggio"
                className="text-xs px-1.5 text-neutral-400 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome"
          className="text-sm bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 w-40"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrizione (cappotto rosso…)"
          className="text-sm bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 w-64"
        />
        <Choose value={ref} onChange={setRef} width={190} size="m"
                title="Foto di riferimento"
                items={[{ v: "", text: "Nessun riferimento" },
                       ...photos.map((p) => ({ v: p.id, text: p.id }))]} />
        <button
          disabled={!name.trim() || busy}
          onClick={() => {
            onSave({
              name: name.trim(),
              description: description.trim() || null,
              reference_photo_id: ref || null,
            });
            setName("");
            setDescription("");
            setRef("");
          }}
          className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
        >
          Aggiungi
        </button>
      </div>
    </section>
  );
}

// ---- Bring existing photos in ----------------------------------------------

function AddExisting({
  photos,
  busy,
  onAdd,
}: {
  photos: PhotoListItem[];
  busy: boolean;
  onAdd: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 space-y-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium flex items-center gap-2"
      >
        <span>{open ? "▾" : "▸"}</span>
        Porta foto esistenti nello storyboard
        <span className="text-neutral-400 font-normal">({photos.length} fuori dal board)</span>
      </button>

      {open && (
        <>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 max-h-64 overflow-y-auto">
            {photos.map((p) => {
              const on = picked.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    setPicked((prev) =>
                      on ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                    )
                  }
                  className={
                    "aspect-square rounded overflow-hidden border-2 transition-colors " +
                    (on ? "border-sky-500" : "border-transparent hover:border-neutral-600")
                  }
                >
                  <img
                    src={thumbRawUrl(p.id, 160)}
                    alt={p.id}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </button>
              );
            })}
          </div>
          <button
            disabled={!picked.length || busy}
            onClick={() => {
              onAdd(picked);
              setPicked([]);
            }}
            className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
          >
            Aggiungi {picked.length || ""} in coda al board
          </button>
        </>
      )}
    </section>
  );
}

// ---- Board settings ---------------------------------------------------------

function BoardSettings({
  settings,
  onChange,
}: {
  settings: StoryboardSettings;
  onChange: (patch: Partial<StoryboardSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
      >
        Formato {ratioLabel(settings.aspect_ratio)} · {settings.fps}fps
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-3 space-y-2 shadow-xl">
          <label className="block text-xs text-neutral-400 space-y-1">
            <span>Formato</span>
            <Choose value={String(settings.aspect_ratio)} width={296} size="m"
                    onChange={(v) => onChange({ aspect_ratio: Number(v) })}
                    items={[{ v: String(16 / 9), text: "16:9" }, { v: "2.39", text: "2.39:1" },
                           { v: String(4 / 3), text: "4:3" }, { v: "1", text: "1:1" },
                           { v: String(9 / 16), text: "9:16" }]} />
          </label>
          <label className="block text-xs text-neutral-400 space-y-1">
            <span>FPS</span>
            <NumberField value={settings.fps} min={1} max={120} width={296}
                    onChange={(fps) => { if (fps !== settings.fps) onChange({ fps }); }} />
          </label>
          <label className="block text-xs text-neutral-400 space-y-1">
            <span>Stile dei pannelli (preambolo del prompt)</span>
            <textarea
              defaultValue={settings.style}
              rows={5}
              onBlur={(e) => {
                const style = e.target.value.trim();
                if (style && style !== settings.style) onChange({ style });
              }}
              className="w-full text-xs bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 resize-y"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ---- helpers ----------------------------------------------------------------

function formatDuration(ms: number): string {
  const total = Math.round(ms / 100) / 10;
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function ratioLabel(ratio: number): string {
  const known: [number, string][] = [
    [16 / 9, "16:9"],
    [2.39, "2.39:1"],
    [4 / 3, "4:3"],
    [1, "1:1"],
    [9 / 16, "9:16"],
  ];
  const hit = known.find(([r]) => Math.abs(r - ratio) < 0.01);
  return hit ? hit[1] : ratio.toFixed(2);
}
