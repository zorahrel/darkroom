// CLI entrypoint for: bun run server/cli.ts <init|import|reset-orphans>
import { initSchema, db } from "./db.ts";
import { runImporter } from "./importer.ts";

const cmd = process.argv[2];

switch (cmd) {
  case "init": {
    initSchema();
    console.log("OK: schema initialized");
    break;
  }
  case "import": {
    initSchema();
    const result = runImporter();
    console.log("Import complete:");
    console.log(`  photos in DB: ${result.photos}`);
    console.log(`  versions imported (direct match): ${result.versionsImported}`);
    console.log(`  orphans pending manual mapping: ${result.orphans}`);
    break;
  }
  case "stats": {
    initSchema();
    const d = db();
    const photos =
      d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM photos").get()?.n ??
      0;
    const versions =
      d
        .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM versions")
        .get()?.n ?? 0;
    const favorites =
      d
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM photos WHERE favorite_version_id IS NOT NULL",
        )
        .get()?.n ?? 0;
    const orphans =
      d
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM orphans WHERE assigned_photo_id IS NULL AND skipped = 0",
        )
        .get()?.n ?? 0;
    const jobsPending =
      d
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'",
        )
        .get()?.n ?? 0;
    console.log(JSON.stringify({ photos, versions, favorites, orphans, jobsPending }, null, 2));
    break;
  }
  default: {
    console.error(
      "Usage: bun run server/cli.ts <init|import|stats>",
    );
    process.exit(1);
  }
}
