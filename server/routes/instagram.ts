import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../config.ts";
import { safeSeg, serveFile } from "../http.ts";
import {
  type AvatarRef,
  type IgPalette,
  avatarUrl,
  getIgSettings,
  isValidLut,
  isValidUsername,
  plannedPosts,
  profileDir,
  readProfile,
  setIgSettings,
} from "../instagram.ts";
import { getProject } from "../project.ts";

/**
 * Anteprima del profilo Instagram (vedi `server/instagram.ts`).
 *
 *   GET  /api/instagram           profilo, impostazioni, post in programma
 *   PUT  /api/instagram           { username?, avatar? }
 *   POST /api/instagram/refresh   rilegge il profilo pubblico (WebKit, ~15 s)
 *   GET  /instagram-media/:user/:file
 */
export const instagramRoutes = new Hono();

/** Le immagini della copia locale, con l'indirizzo che il client usa cosi' com'e'. */
function withUrls(username: string) {
  const p = readProfile(username);
  if (!p) return null;
  const u = (f: string | null) =>
    f ? `/instagram-media/${encodeURIComponent(username)}/${encodeURIComponent(f)}` : null;
  return {
    ...p,
    avatar: u(p.avatar),
    highlights: p.highlights.map((h) => ({ ...h, image: u(h.image) })),
    posts: p.posts.map((x) => ({ ...x, image: u(x.image) })),
  };
}

// `?palette=1` mostra copertine e avatar con le LUT della palette di prova.
instagramRoutes.get("/api/instagram", (c) => {
  const settings = getIgSettings();
  const profile = settings.username ? withUrls(settings.username) : null;
  const pal = c.req.query("palette") === "1" ? settings.palette ?? null : null;
  return c.json({
    settings,
    profile,
    avatar: settings.avatar ? avatarUrl(settings.avatar, pal?.avatar_lut) : null,
    planned: plannedPosts(pal?.planned_lut),
  });
});

instagramRoutes.put("/api/instagram", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    username?: unknown;
    avatar?: unknown;
    palette?: unknown;
  };
  const patch: { username?: string | null; avatar?: AvatarRef | null; palette?: IgPalette | null } = {};
  if ("palette" in body) {
    const pl = body.palette as Partial<IgPalette> | null;
    if (pl === null) patch.palette = null;
    else {
      const ok = (x: unknown) => x === null || x === undefined || isValidLut(x);
      if (!pl || !ok(pl.planned_lut) || !ok(pl.avatar_lut)) {
        return c.json({ error: "palette: LUT inesistente o fuori dalla cartella delle LUT" }, 400);
      }
      patch.palette = { planned_lut: pl.planned_lut ?? null, avatar_lut: pl.avatar_lut ?? null };
    }
  }
  if ("username" in body) {
    if (body.username !== null && !isValidUsername(body.username)) {
      return c.json({ error: "nome utente non valido" }, 400);
    }
    patch.username = body.username as string | null;
  }
  if ("avatar" in body) {
    const a = body.avatar as Partial<AvatarRef> | null;
    if (a === null) patch.avatar = null;
    else if (
      a &&
      typeof a.project === "string" &&
      getProject(a.project) &&
      typeof a.photo === "string" &&
      Number.isInteger(a.version)
    ) {
      const focus = typeof a.focus_y === "number" ? Math.min(1, Math.max(0, a.focus_y)) : undefined;
      patch.avatar = { project: a.project, photo: a.photo, version: a.version as number, focus_y: focus };
      if (!avatarUrl(patch.avatar)) return c.json({ error: "versione non trovata" }, 404);
    } else {
      return c.json({ error: "avatar: servono project, photo e version" }, 400);
    }
  }
  return c.json({ settings: setIgSettings(patch) });
});

instagramRoutes.post("/api/instagram/refresh", async (c) => {
  const { username } = getIgSettings();
  if (!username) return c.json({ error: "prima scegli l'account" }, 400);
  const node = Bun.which("node") ?? "/opt/homebrew/bin/node";
  const proc = Bun.spawn([node, join(REPO_ROOT, "scripts", "ig_snapshot.mjs"), username, profileDir(username)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 120_000);
  const code = await proc.exited;
  clearTimeout(timer);
  if (code !== 0) {
    const err = (await new Response(proc.stderr).text()).trim().split("\n").slice(-3).join(" ");
    return c.json({ error: `lettura del profilo fallita: ${err || `uscita ${code}`}` }, 502);
  }
  return c.json({ profile: withUrls(username) });
});

instagramRoutes.get("/instagram-media/:user/:file", (c) => {
  const user = c.req.param("user");
  const file = c.req.param("file");
  if (!isValidUsername(user) || !safeSeg(file)) return new Response("bad request", { status: 400 });
  const p = join(profileDir(user), file);
  if (!existsSync(p)) return new Response("not found", { status: 404 });
  return serveFile(p);
});
