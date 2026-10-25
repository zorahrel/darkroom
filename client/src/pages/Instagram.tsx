import { useCallback, useEffect, useState } from "react";
import { assoluto, jsonFetch } from "../api/http";

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
  settings: { username: string | null; avatar: AvatarRef | null };
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

  const load = useCallback(async () => {
    try {
      const d = await jsonFetch<Payload>("/api/instagram");
      setData(d);
      setUser(d.settings.username ?? "");
      const a = d.settings.avatar;
      if (a) setAv({ project: a.project, photo: a.photo, version: String(a.version) });
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, []);
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

  const p = data?.profile ?? null;
  const planned = showPlanned ? (data?.planned ?? []).filter((x) => x.cover) : [];
  const realCount = Number((p?.counts.posts ?? "").replace(/[.,]/g, "")) || null;
  const postCount = realCount != null ? (realCount + planned.length).toLocaleString("it-IT") : p?.counts.posts;
  const avatarSrc = data?.avatar ?? p?.avatar ?? null;
  const focusY = data?.settings.avatar?.focus_y ?? (data?.avatar ? 0.32 : 0.5);

  return (
    <div className="flex flex-wrap gap-8 p-6 items-start" data-testid="instagram-page">
      <Phone dark={dark}>
        {!p ? (
          <div className="p-6 text-sm opacity-70">
            {data?.settings.username
              ? "Nessuna copia del profilo: premi «Aggiorna dal profilo»."
              : "Scegli l'account a destra."}
          </div>
        ) : (
          <ProfileView
            p={p}
            dark={dark}
            avatar={avatarSrc}
            focusY={focusY}
            postCount={postCount ?? null}
            planned={planned}
          />
        )}
      </Phone>

      <aside className="w-80 space-y-5 text-sm text-neutral-300">
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

function Phone({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return (
    <div
      className="shrink-0 rounded-[56px] p-[12px] bg-neutral-950 shadow-2xl ring-1 ring-neutral-700"
      style={{ width: W + 24 }}
    >
      <div
        data-testid="ig-screen"
        className="ig-screen relative overflow-y-auto overflow-x-hidden rounded-[44px] overscroll-contain"
        style={{
          width: W,
          height: `min(${H}px, calc(100vh - 120px))`,
          background: dark ? "#000" : "#fff",
          color: dark ? "#f5f5f5" : "#000",
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          fontSize: 14,
          scrollbarWidth: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ProfileView({
  p,
  dark,
  avatar,
  focusY,
  postCount,
  planned,
}: {
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
          <span style={{ fontSize: 26, fontWeight: 300, width: 56 }}>＋</span>
          <b style={{ fontSize: 20 }}>{p.username} ⌄</b>
          <span style={{ fontSize: 20, width: 56, textAlign: "right" }}>@ ≡</span>
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
        {p.link && <div style={{ fontWeight: 600, marginTop: 2 }}>🔗 {p.link.text}</div>}
      </div>

      <div className="flex" style={{ gap: 6, padding: "14px 16px 0" }}>
        {["Modifica", "Condividi profilo"].map((t) => (
          <div key={t} className="flex-1 flex items-center justify-center rounded-lg" style={{ height: 32, background: muted, fontWeight: 600 }}>
            {t}
          </div>
        ))}
        <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 32, background: muted }}>
          👤
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
        {tiles.map((t) => (
          <div key={t.key} className="relative overflow-hidden" style={{ aspectRatio: "3 / 4", background: muted }} title={t.title}>
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

      <div
        className="sticky bottom-0 flex justify-around"
        style={{ height: 84, paddingTop: 12, background: dark ? "#000" : "#fff", borderTop: `1px solid ${line}`, fontSize: 24 }}
      >
        <span>⌂</span>
        <span>⌕</span>
        <span>＋</span>
        <span>▷</span>
        <span className="rounded-full overflow-hidden" style={{ width: 28, height: 28, border: `2px solid ${fg}` }}>
          {avatar && (
            <img src={assoluto(avatar)} alt="" className="w-full h-full object-cover" style={{ objectPosition: `50% ${Math.round(focusY * 100)}%` }} />
          )}
        </span>
      </div>
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
const ReelsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
