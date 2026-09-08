import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ICONS } from "../client/src/iconNames.ts";
import { TOOLS } from "../server/tools.ts";

test("ogni scheda del catalogo ha un'icona renderizzabile, senza ripiegare sul simbolo generico", () => {
  for (const tool of TOOLS) {
    const icon = ICONS[tool.icon];
    expect(icon, `${tool.id}: icona sconosciuta «${tool.icon}»`).toBeDefined();
    expect(renderToStaticMarkup(createElement(icon!))).toContain("<svg");
  }
});
