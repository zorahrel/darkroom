import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, SlidersHorizontal, X } from "lucide-react";
import { assoluto, jsonFetch } from "../api/http";
import { FullscreenView } from "../components/detail/FullscreenView";

/**
 * Anteprima del profilo Instagram, scrollabile dentro un iPhone.
 *
 * Il profilo e' quello vero dell'account (copia locale letta dalla pagina
 * pubblica, vedi `server/instagram.ts`); in cima alla griglia ci sono i post del
 * progetto (le sue collezioni) come se fossero gia' usciti, e al posto della foto
 * profilo si puo' provare una versione qualsiasi. Serve a giudicare l'insieme,
 * colore compreso, prima di pubblicare: il punto di partenza della pubblicazione.
 *
 * Le misure sono quelle dell'app su iPhone 15 Pro (393×852 punti), e i riquadri
 * della griglia sono 3:4 come nell'app dal 2025: la griglia ritaglia, ed e' giusto
 * cosi', perche' e' quello che vedra' chi apre il profilo.
 */

type Kind = "reel" | "carousel" | "photo";
type Profile = {
  username: string;
  fetched_at: number;
  full_name: string;
  counts: { posts: string | null; followers: string | null; following: string | null };
  bio: string[];
  link: { text: string; url: string | null } | null;
  avatar: string | null;
  highlights: { title: string; image: string | null }[];
  posts: { href: string; kind: Kind; alt: string; image: string | null }[];
};
type AvatarRef = { project: string; photo: string; version: number; focus_y?: number };
type Planned = { id: string; title: string; caption: string; photo_count: number; kind: Kind; cover: string | null };
type Payload = {
  avatar_candidates?: { version: number; url: string; current: boolean }[];
  settings: {
    username: string | null;
    avatar: AvatarRef | null;
    palette?: { planned_lut: string | null; avatar_lut: string | null } | null;
  };
  profile: Profile | null;
  avatar: string | null;
  planned: Planned[];
};

const W = 393;
const H = 852;

export default function Instagram() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("darkroom.ig.tema") !== "chiaro");
  const [showPlanned, setShowPlanned] = useState(true);
  const [user, setUser] = useState("");
  const [av, setAv] = useState({ project: "", photo: "", version: "" });
  const [palette, setPalette] = useState(false);
  // Le impostazioni non stanno sempre aperte: si aprono dall'ingranaggio.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSettingsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch<Payload>(`/api/instagram${palette ? "?palette=1" : ""}`);
      setData(d);
      setUser(d.settings.username ?? "");
      const a = d.settings.avatar;
      if (a) setAv({ project: a.project, photo: a.photo, version: String(a.version) });
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, [palette]);
  useEffect(() => void load(), [load]);
  useEffect(() => localStorage.setItem("darkroom.ig.tema", dark ? "scuro" : "chiaro"), [dark]);

  const save = async (body: object) => {
    setBusy(true);
    try {
      await jsonFetch("/api/instagram", { method: "PUT", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await jsonFetch("/api/instagram/refresh", { method: "POST" });
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const p = data?.profile ?? null;
  const planned = showPlanned ? (data?.planned ?? []).filter((x) => x.cover) : [];
  const realCount = Number((p?.counts.posts ?? "").replace(/[.,]/g, "")) || null;
  const postCount = realCount != null ? (realCount + planned.length).toLocaleString("it-IT") : p?.counts.posts;
  const avatarSrc = data?.avatar ?? p?.avatar ?? null;
  const focusY = data?.settings.avatar?.focus_y ?? (data?.avatar ? 0.32 : 0.5);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (open != null || settingsOpen || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      if (e.key === "+" || e.key === "=") setZoom((z) => clampZoom(z * 1.25));
      else if (e.key === "-") setZoom((z) => clampZoom(z / 1.25));
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, settingsOpen]);

  const gallery = p
    ? [
        ...planned.map((x) => ({ src: assoluto(big(x.cover ?? "")), alt: x.title ?? "" })),
        ...p.posts.map((x) => ({ src: assoluto(big(x.image ?? "")), alt: x.alt ?? "" })),
      ]
    : [];

  return (
    <div className="relative flex flex-col items-center gap-3 p-3 md:p-6" data-testid="instagram-page">
      <button
        type="button"
        data-testid="ig-settings-btn"
        aria-label="Impostazioni anteprima"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen(true)}
        className="self-end sm:absolute sm:top-3 sm:right-3 md:top-6 md:right-6 z-10 flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/90 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        <SlidersHorizontal size={16} aria-hidden />
        <span className="hidden sm:inline">Impostazioni</span>
      </button>
      <Phone zoom={zoom} onZoom={setZoom} dark={dark} overlay={p ? <TabBar dark={dark} avatar={avatarSrc} focusY={focusY} /> : null}>
        {!p ? (
          <div className="p-6 pt-24 text-sm opacity-70 space-y-3">
            <p>
              {data?.settings.username
                ? "Nessuna copia del profilo: premi «Aggiorna dal profilo» nelle impostazioni."
                : "Scegli l'account nelle impostazioni."}
            </p>
            <button type="button" className="underline" onClick={() => setSettingsOpen(true)}>
              Apri le impostazioni
            </button>
          </div>
        ) : (
          <ProfileView
            p={p}
            dark={dark}
            avatar={avatarSrc}
            focusY={focusY}
            postCount={postCount ?? null}
            planned={planned}
            onOpen={setOpen}
          />
        )}
      </Phone>

      <div
        data-testid="ig-zoom"
        className="fixed z-20 bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900/90 p-1 text-neutral-200 shadow-lg"
      >
        <button type="button" aria-label="Rimpicciolisci" className="rounded-full p-2 hover:bg-neutral-800" onClick={() => setZoom((z) => clampZoom(z / 1.25))}>
          <Minus size={16} aria-hidden />
        </button>
        <button type="button" aria-label="Adatta" title="Adatta (0)" className="min-w-14 rounded-full px-2 py-1 text-xs tabular-nums hover:bg-neutral-800" onClick={() => setZoom(1)} data-testid="ig-zoom-level">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" aria-label="Ingrandisci" className="rounded-full p-2 hover:bg-neutral-800" onClick={() => setZoom((z) => clampZoom(z * 1.25))}>
          <Plus size={16} aria-hidden />
        </button>
        <button type="button" aria-label="Adatta allo spazio" className="rounded-full p-2 hover:bg-neutral-800" onClick={() => setZoom(1)}>
          <Maximize2 size={14} aria-hidden />
        </button>
      </div>

      {open != null && gallery[open] && (
        <FullscreenView
          src={gallery[open].src}
          alt={gallery[open].alt}
          gallery={gallery}
          index={open}
          onIndex={setOpen}
          zoomable
          onClose={() => setOpen(null)}
        />
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40" data-testid="ig-settings-backdrop" onClick={() => setSettingsOpen(false)} />
      )}
      <aside
        data-testid="ig-settings"
        aria-label="Impostazioni anteprima"
        aria-hidden={!settingsOpen}
        className={`fixed top-0 right-0 bottom-0 z-50 w-[min(22rem,90vw)] overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-5 space-y-5 text-sm text-neutral-300 shadow-2xl transition-transform duration-200 ${
          settingsOpen ? "translate-x-0" : "translate-x-full invisible"
        }`}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-neutral-100 font-semibold text-base">Impostazioni anteprima</h1>
          <button type="button" aria-label="Chiudi" className="rounded p-1 hover:bg-neutral-800" onClick={() => setSettingsOpen(false)}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <section className="space-y-2">
          <h2 className="text-neutral-100 font-semibold">Account</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
              value={user}
              placeholder="nome utente"
              onChange={(e) => setUser(e.target.value.trim())}
            />
            <button className="px-3 rounded bg-neutral-800 hover:bg-neutral-700" disabled={busy} onClick={() => save({ username: user || null })}>
              Salva
            </button>
          </div>
          <button
            className="w-full py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
            disabled={busy || !data?.settings.username}
            onClick={refresh}
          >
            {busy ? "Leggo il profilo…" : "Aggiorna dal profilo"}
          </button>
          {p && (
            <p className="text-xs text-neutral-500">
              Letto il {new Date(p.fetched_at).toLocaleString("it-IT")} dalla pagina pubblica: {p.posts.length} post
              visibili senza accesso, {p.highlights.length} evidenze.
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-neutral-100 font-semibold">Foto profilo</h2>
          {(data?.avatar_candidates?.length ?? 0) > 0 && (
            <div data-testid="ig-candidates" className="grid grid-cols-4 gap-1.5">
              {data!.avatar_candidates!.map((c) => (
                <button
                  key={c.version}
                  type="button"
                  disabled={busy || c.current}
                  title={`Prova v${c.version} come foto profilo`}
                  onClick={() =>
                    data?.settings.avatar &&
                    save({ avatar: { project: data.settings.avatar.project, photo: data.settings.avatar.photo, version: c.version } })
                  }
                  className={`relative aspect-square rounded bg-black overflow-hidden border ${c.current ? "border-sky-400" : "border-neutral-700 hover:border-neutral-400"}`}
                >
                  <img src={assoluto(c.url)} alt={`v${c.version}`} loading="lazy" className="w-full h-full object-contain" />
                  <span className="absolute left-0.5 bottom-0.5 text-[10px] px-1 rounded bg-black/70 text-neutral-100">v{c.version}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1" placeholder="progetto" value={av.project} onChange={(e) => setAv({ ...av, project: e.target.value.trim() })} />
            <input className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1" placeholder="foto" value={av.photo} onChange={(e) => setAv({ ...av, photo: e.target.value.trim() })} />
            <input className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1" placeholder="versione" value={av.version} onChange={(e) => setAv({ ...av, version: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
              disabled={busy || !av.project || !av.photo || !av.version}
              onClick={() => save({ avatar: { project: av.project, photo: av.photo, version: Number(av.version) } })}
            >
              Prova questa
            </button>
            <button className="flex-1 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" disabled={busy} onClick={() => save({ avatar: null })}>
              Quella di oggi
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-neutral-100 font-semibold">Vista</h2>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showPlanned} onChange={(e) => setShowPlanned(e.target.checked)} />
            Post del progetto in cima ({(data?.planned ?? []).filter((x) => x.cover).length})
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            Tema scuro
          </label>
          {/* La palette di prova si vede solo qui: il grade del progetto e le
              versioni della foto profilo restano come sono. */}
          <label className="flex items-center gap-2" title={data?.settings.palette ? `${data.settings.palette.planned_lut ?? "—"} · ${data.settings.palette.avatar_lut ?? "—"}` : "nessuna palette impostata"}>
            <input
              type="checkbox"
              checked={palette}
              disabled={!data?.settings.palette}
              onChange={(e) => setPalette(e.target.checked)}
            />
            Palette del feed (prova)
          </label>
        </section>

        {(data?.planned.length ?? 0) > 0 && (
          <section className="space-y-1">
            <h2 className="text-neutral-100 font-semibold">In programma, dal più recente</h2>
            <ol className="space-y-1">
              {data!.planned.map((x) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <span className="truncate">{x.title || x.id}</span>
                  <span className="text-neutral-500 shrink-0">
                    {x.photo_count} foto{x.cover ? "" : " · senza copertina"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {err && <p className="text-red-400 text-xs">{err}</p>}
      </aside>
    </div>
  );
}

/**
 * Il telefono e' sempre 393×852 punti: se la finestra e' piu' bassa si
 * rimpicciolisce tutto insieme, invece di accorciare lo schermo. Accorciarlo
 * cambiava le proporzioni e mostrava meno griglia di quanta ne veda un iPhone
 * vero, cioe' proprio la cosa da giudicare.
 */
function clampZoom(z: number) {
  return Math.min(6, Math.max(1, Math.round(z * 100) / 100));
}

/** Immagine del lightbox: la stessa del riquadro, chiesta piu' grande dove la
 *  rotta accetta una larghezza (copertine del progetto); le foto di Instagram
 *  restano quelle della copia locale. */
function big(src: string) {
  return /[?&]w=\d+/.test(src) ? src.replace(/([?&]w=)\d+/, "$12400") : src;
}

function Phone({
  dark,
  children,
  overlay,
  zoom,
  onZoom,
}: {
  dark: boolean;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  zoom: number;
  onZoom: (z: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const [fitScale, setScale] = useState(1);
  const [area, setArea] = useState({ w: W + 24, h: H + 24 });
  const scale = fitScale * zoom;
  // punto da tenere fermo sotto il cursore mentre lo zoom cambia
  const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useLayoutEffect(() => {
    const fit = () => {
      const el = view.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Su schermo stretto la barra di Darkroom e' fissa in basso: il telefono
      // deve finire sopra di lei, o la sua barra di Instagram ci passa sotto.
      const nav = document.querySelector('nav[aria-label="Navigazione principale"]');
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      const byH = (window.innerHeight - navH - top - 16) / (H + 24);
      // larghezza utile del contenitore, senza il suo padding
      const par = el.parentElement;
      const cs = par ? getComputedStyle(par) : null;
      const avail = par && cs ? par.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : W + 24;
      const byW = avail / (W + 24);
      setScale(Math.max(0.25, Math.min(1, byH, byW)));
      setArea({ w: Math.max(0, avail), h: Math.max(0, (window.innerHeight - navH - top - 16)) });
    };
    fit();
    window.addEventListener("resize", fit);
    // Cio' che sta sopra il telefono puo' arrivare dopo (un avviso, l'intestazione
    // che si riempie) e spingerlo in basso senza nessun resize della finestra.
    // Il body ha altezza fissa: si osservano i contenitori del telefono, che
    // crescono quando sopra di lui compare qualcosa.
    const ro = new ResizeObserver(fit);
    for (let a = view.current?.parentElement; a && a !== document.body; a = a.parentElement) ro.observe(a);
    return () => {
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, []);
  // Rotella con Ctrl/Cmd (e il pizzico del trackpad, che il browser manda cosi')
  // ingrandisce attorno al cursore. Deve poter fermare lo zoom della pagina:
  // listener non passivo.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = v.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const s = scaleRef.current;
      anchor.current = { x, y, px: (v.scrollLeft + x) / s, py: (v.scrollTop + y) / s };
      onZoom(clampZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0025)));
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const a = anchor.current;
    if (a) {
      v.scrollLeft = a.px * scale - a.x;
      v.scrollTop = a.py * scale - a.y;
      anchor.current = null;
    } else if (zoom > 1) {
      // dai pulsanti e dai tasti: resta centrato su cio' che si stava guardando
      v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
    }
  }, [scale, zoom]);

  // Trascinare sposta l'inquadratura quando e' ingrandito; un trascinamento
  // vero (oltre 4 px) non deve diventare un clic su un post.
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const zoomed = zoom > 1.001;
  const boxW = (W + 24) * scale;
  const boxH = (H + 24) * scale;
  return (
    <div
      ref={view}
      data-testid="ig-viewport"
      className={zoomed ? "overflow-auto cursor-grab active:cursor-grabbing" : ""}
      style={zoomed ? { width: area.w, height: area.h } : { width: boxW, height: boxH }}
      onPointerDown={(e) => {
        if (!zoomed || e.button !== 0) return;
        const v = view.current!;
        drag.current = { x: e.clientX, y: e.clientY, l: v.scrollLeft, t: v.scrollTop, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        const v = view.current!;
        v.scrollLeft = d.l - dx;
        v.scrollTop = d.t - dy;
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) {
          // il clic che segue il rilascio non deve aprire il post sotto il cursore
          const stop = (ev: MouseEvent) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          window.addEventListener("click", stop, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
        }
      }}
      onPointerLeave={() => {
        drag.current = null;
      }}
    >
    <div
      ref={box}
      className="shrink-0"
      style={{ width: boxW, height: boxH, margin: zoomed && boxW < area.w ? "0 auto" : undefined }}
    >
      <div
        className="rounded-[56px] p-[12px] bg-neutral-950 shadow-2xl ring-1 ring-neutral-700"
        style={{ width: W + 24, height: H + 24, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {/* La cornice non scorre: dentro c'e' l'area che scorre e, sopra, la barra.
            Una barra `sticky` in fondo allo stesso contenitore che scorre restava
            ferma solo a fine pagina (e WebKit col telefono scalato la sganciava). */}
        <div
          data-testid="ig-frame"
          className="relative overflow-hidden rounded-[44px]"
          style={{
            width: W,
            height: H,
            background: dark ? "#000" : "#fff",
            color: dark ? "#f5f5f5" : "#000",
            fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
            fontSize: 14,
          }}
        >
          <div
            data-testid="ig-screen"
            className="ig-screen absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
            style={{ scrollbarWidth: "none" }}
          >
            {children}
          </div>
          {overlay}
        </div>
      </div>
    </div>
    </div>
  );
}

function ProfileView({
  onOpen,
  p,
  dark,
  avatar,
  focusY,
  postCount,
  planned,
}: {
  onOpen?: (i: number) => void;
  p: Profile;
  dark: boolean;
  avatar: string | null;
  focusY: number;
  postCount: string | null;
  planned: Planned[];
}) {
  const muted = dark ? "#262626" : "#efefef";
  const line = dark ? "#262626" : "#dbdbdb";
  const sub = dark ? "#a8a8a8" : "#737373";
  const fg = dark ? "#f5f5f5" : "#000";
  const tiles = [
    ...planned.map((x) => ({ key: `pl-${x.id}`, src: x.cover, kind: x.kind, title: x.title })),
    ...p.posts.map((x, i) => ({ key: `ig-${i}`, src: x.image, kind: x.kind, title: x.alt })),
  ];
  return (
    <>
      <div className="sticky top-0 z-10" style={{ background: dark ? "#000" : "#fff" }}>
        <div className="flex justify-between items-center font-semibold" style={{ height: 54, padding: "14px 34px 0", fontSize: 16 }}>
          <span>9:41</span>
          <span className="flex gap-1.5 items-center">
            <svg width="18" height="12" viewBox="0 0 18 12" fill={fg}>
              <rect x="0" y="8" width="3" height="4" rx="1" />
              <rect x="5" y="5" width="3" height="7" rx="1" />
              <rect x="10" y="2" width="3" height="10" rx="1" />
              <rect x="15" y="0" width="3" height="12" rx="1" />
            </svg>
            <svg width="27" height="13" viewBox="0 0 27 13">
              <rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke={sub} fill="none" />
              <rect x="2" y="2" width="18" height="9" rx="2" fill={fg} />
              <rect x="25" y="4" width="2" height="5" rx="1" fill={sub} />
            </svg>
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ height: 44, padding: "0 16px" }}>
          <span style={{ width: 64 }}>
            <PlusIcon size={26} />
          </span>
          <b className="flex items-center" style={{ fontSize: 20, gap: 4 }}>
            {p.username}
            <ChevronIcon />
          </b>
          <span className="flex justify-end items-center" style={{ width: 64, gap: 18 }}>
            <ThreadsIcon />
            <MenuIcon />
          </span>
        </div>
      </div>

      <div className="flex items-center" style={{ gap: 22, padding: "6px 16px 0" }}>
        <div className="shrink-0 rounded-full overflow-hidden" style={{ width: 88, height: 88, background: muted }}>
          {avatar && (
            <img
              data-testid="ig-avatar"
              src={assoluto(avatar)}
              alt=""
              className="w-full h-full object-cover"
              style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }}
            />
          )}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{p.full_name}</div>
          <div className="flex" style={{ gap: 24 }}>
            <Stat n={postCount} label="post" />
            <Stat n={p.counts.followers} label="follower" />
            <Stat n={p.counts.following} label="seguiti" />
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px 0", lineHeight: "18px" }}>
        {p.bio.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {p.link && (
          <div className="flex items-center" style={{ fontWeight: 600, marginTop: 2, gap: 5 }}>
            <LinkIcon />
            {p.link.text}
          </div>
        )}
      </div>

      <div className="flex" style={{ gap: 6, padding: "14px 16px 0" }}>
        {["Modifica", "Condividi profilo"].map((t) => (
          <div key={t} className="flex-1 flex items-center justify-center rounded-lg" style={{ height: 32, background: muted, fontWeight: 600 }}>
            {t}
          </div>
        ))}
        <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 32, background: muted }}>
          <AddPersonIcon />
        </div>
      </div>

      <div className="flex overflow-x-auto" style={{ gap: 14, padding: "18px 16px 4px", scrollbarWidth: "none" }}>
        {p.highlights.map((h, i) => (
          <div key={i} className="flex flex-col items-center shrink-0" style={{ width: 64, gap: 5 }}>
            <div className="rounded-full" style={{ width: 64, height: 64, border: `1px solid ${line}`, padding: 2 }}>
              {h.image && <img src={assoluto(h.image)} alt="" className="w-full h-full rounded-full object-cover" />}
            </div>
            <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{h.title}</span>
          </div>
        ))}
      </div>

      <div className="flex" style={{ marginTop: 10, borderBottom: `1px solid ${line}` }}>
        {[GridIcon, ReelsIcon, TagIcon].map((I, k) => (
          <div
            key={k}
            className="flex-1 flex items-center justify-center"
            style={{ height: 44, color: k === 0 ? fg : sub, borderBottom: k === 0 ? `1px solid ${fg}` : undefined }}
          >
            <I />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3" style={{ gap: 2 }} data-testid="ig-grid">
        {tiles.map((t, i) => (
          <div
            key={t.key}
            className="relative overflow-hidden cursor-zoom-in"
            style={{ aspectRatio: "3 / 4", background: muted }}
            title={t.title}
            data-testid="ig-tile"
            onClick={() => t.src && onOpen?.(i)}
          >
            {t.src && <img src={assoluto(t.src)} alt="" loading="lazy" className="w-full h-full object-cover block" />}
            {t.kind !== "photo" && (
              <span className="absolute" style={{ top: 6, right: 6, filter: "drop-shadow(0 0 2px rgba(0,0,0,.6))" }}>
                {t.kind === "reel" ? <ReelBadge /> : <CarouselBadge />}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Un visitatore vede solo i post piu' recenti: il resto c'e' ma la copia
          locale non lo ha. Detto in fondo, invece di far finire il profilo li'. */}
      {p.counts.posts && Number(p.counts.posts.replace(/[.,]/g, "")) > p.posts.length && (
        <div className="text-center" style={{ padding: "18px 16px 24px", fontSize: 12, color: sub }}>
          Altri {(Number(p.counts.posts.replace(/[.,]/g, "")) - p.posts.length).toLocaleString("it-IT")} post:
          Instagram non li mostra senza accesso.
        </div>
      )}

      {/* Il contenuto passa sotto la barra di vetro, come nell'app: in fondo
          serve lo spazio perche' l'ultima riga possa salire sopra la barra. */}
      <div style={{ height: TAB_SPACE }} />
    </>
  );
}

/** Spazio in fondo allo scroll: barra (62) + distanza dal bordo (24) + aria. */
const TAB_SPACE = 104;

/**
 * Barra di Instagram su iOS 26 (Liquid Glass, rollout dic 2025 - giu 2026):
 * capsula di vetro che galleggia sopra il bordo, cinque schede nell'ordine
 * Home, Reels, Messaggi, Cerca, Profilo. Il «crea» non e' piu' qui, sta in alto.
 * Sotto, l'indicatore home dell'iPhone.
 */
function TabBar({ dark, avatar, focusY }: { dark: boolean; avatar: string | null; focusY: number }) {
  const fg = dark ? "#f5f5f5" : "#000";
  return (
    <>
      <div
        data-testid="ig-tabbar"
        className="absolute flex items-center justify-between"
        style={{
          left: 14,
          right: 14,
          bottom: 22,
          height: 62,
          padding: "0 6px 0 24px",
          borderRadius: 31,
          color: fg,
          background: dark ? "rgba(38,38,42,0.62)" : "rgba(255,255,255,0.62)",
          backdropFilter: "blur(18px) saturate(170%) brightness(1.08)",
          WebkitBackdropFilter: "blur(18px) saturate(170%) brightness(1.08)",
          border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.07)"}`,
          boxShadow: `0 10px 30px rgba(0,0,0,${dark ? 0.45 : 0.14}), inset 0 1px 0 rgba(255,255,255,${dark ? 0.16 : 0.7})`,
          zIndex: 20,
        }}
      >
        <HomeIcon />
        <ReelsIcon size={25} />
        <DirectIcon />
        <SearchIcon />
        {/* scheda attiva: la lente piu' chiara dietro, come le tab bar di iOS 26 */}
        <span
          className="flex items-center justify-center"
          style={{ width: 84, height: 50, borderRadius: 25, background: dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.07)" }}
        >
          <span className="rounded-full overflow-hidden" style={{ width: 28, height: 28, border: `2px solid ${fg}` }}>
            {avatar && (
              <img src={assoluto(avatar)} alt="" className="w-full h-full object-cover" style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }} />
            )}
          </span>
        </span>
      </div>
      <div
        className="absolute rounded-full"
        style={{ left: "50%", bottom: 8, width: 134, height: 5, marginLeft: -67, background: fg, zIndex: 21 }}
      />
    </>
  );
}

function Stat({ n, label }: { n: string | null; label: string }) {
  return (
    <div className="flex flex-col">
      <b style={{ fontSize: 16, fontWeight: 600 }}>{n ?? "–"}</b>
      <span>{label}</span>
    </div>
  );
}

const GridIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </svg>
);
const ReelsIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M3 8h18M9 3l3 5M15 3l3 5" />
    <path d="M10 11.5v5l4.3-2.5z" fill="currentColor" />
  </svg>
);
const TagIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.5 19c1.2-2.5 3.2-3.7 5.5-3.7s4.3 1.2 5.5 3.7" />
  </svg>
);
const ReelBadge = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <path d="M2 7h20M8 2l3 5M14 2l3 5" />
    <path d="M10 11v6l5-3z" fill="#fff" />
  </svg>
);
const CarouselBadge = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
    <path d="M7 2h11a4 4 0 0 1 4 4v11h-2V6a2 2 0 0 0-2-2H7z" />
    <rect x="2" y="7" width="15" height="15" rx="3" />
  </svg>
);

// Icone nello stile dell'app: tratto 2, angoli tondi. Erano caratteri ed emoji
// (＋, ⌂, 🔗, 👤…): si leggevano come testo e non come l'interfaccia di Instagram.
const line2 = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const PlusIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...line2}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const ChevronIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" {...line2} strokeWidth={3}>
    <path d="M5 9l7 7 7-7" />
  </svg>
);
const ThreadsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...line2}>
    <path d="M16.5 11.2c-.3-2.6-2-4-4.5-4-2.8 0-4.6 2-4.6 4.9 0 3 1.9 4.9 4.6 4.9 2.3 0 3.9-1.4 3.9-3.4 0-2.2-1.9-3.1-4.3-2.6-1.6.3-2.4 1.3-2.2 2.4.2 1.2 1.6 1.7 3 1.4 2-.5 3.1-2.3 3.1-4.9" />
    <path d="M19.5 8.5C18.4 5 15.6 3 12 3 6.9 3 3.5 6.6 3.5 12s3.4 9 8.5 9c3.4 0 6-1.6 7.2-4.4" />
  </svg>
);
const MenuIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...line2}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const LinkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...line2} strokeWidth={2.4}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" />
  </svg>
);
const AddPersonIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" {...line2}>
    <circle cx="9.5" cy="8" r="4" />
    <path d="M2.5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    <path d="M19 8v6M16 11h6" />
  </svg>
);
const DirectIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <line x1="22" y1="3" x2="9.218" y2="10.083" />
    <polygon points="11.698 20.334 22 3.001 2 3.001 9.218 10.084 11.698 20.334" />
  </svg>
);

const HomeIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...line2}>
    <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6h-6v6H4.5a1 1 0 0 1-1-1z" />
  </svg>
);
const SearchIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...line2}>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="M16 16l5 5" />
  </svg>
);
