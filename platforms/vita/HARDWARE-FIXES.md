# PS Vita hardware fixes

## VitaShell `0x8010113D` — LiveArea correction (2026-09-19)

The previous VPK passed ZIP CRC checks and already contained SDK-generated SFO metadata with the expected
title/category/content IDs. Its three LiveArea PNGs were nevertheless RGBA (color type 6), and its template used
`<startup>` instead of `<startup-image>`. Updating SFO fields alone did not address these defects.

The generator now emits indexed PNG-8 (color type 3) with the same two colors, and the background is 840×500.
The template declares `format-ver="01.00"`, `content-rev="1"` and the correct startup element; packaging writes CRLF.
Build validation checks the actual source assets before copying, and regression tests reject the old PNG/XML forms.

References: [VitaSDK image/XML guidance](https://github.com/vitasdk/samples#notes-on-images),
[LiveArea template in gtasa_vita](https://github.com/TheOfficialFloW/gtasa_vita/blob/master/sce_sys/livearea/contents/template.xml).
The installer uses the console's [ScePromoterUtility path](https://github.com/TheOfficialFloW/VitaShell/blob/master/package_installer.c);
Vita3K installation alone cannot prove acceptance by this service. Real VitaShell installation must still be confirmed.

## Earlier fixes

This revision targets two differences that were hidden by Vita3K:

- **White/glitched glow effects:** radial gradients on the Vita backend no longer use overlapping filled circles under additive blending. They are rendered as non-overlapping colored triangle rings, preserving the gradient instead of saturating to white. Inner radial-gradient radii are also respected.
- **VitaShell installation:** regular homebrew metadata now uses `CATEGORY=gd`, a 9-character `TITLE_ID` (`ARCS00001`), and a full `CONTENT_ID` (`EP9000-ARCS00001_00-0000000000000000`). When VitaSDK is available, the build prefers `vita-mksfoex` and `vita-pack-vpk`.

Build with:

```sh
npm install
npm run vita:vpk
```

For the most conservative real-hardware package, build with VitaSDK installed and `VITASDK` exported so the official SFO/VPK tools are used.


## Runtime ABI / `Invalid triangle buffers`

The bundled legacy `eboot.bin` is ABI 1 and does **not** match the current native-canvas bridge.
Do not update `runtime.json` by hand to silence the check. Rebuild the runtime instead:

```bash
npm run vita:runtime
npm run vita:vpk
```

Or use `npm run vita:vpk:fresh` from the repository root. The rebuilt runtime is ABI 2.
A mixed old eboot/new JS bundle can fall back from `strokeLine` to the legacy triangle path and fail with `TypeError: Invalid triangle buffers`.
