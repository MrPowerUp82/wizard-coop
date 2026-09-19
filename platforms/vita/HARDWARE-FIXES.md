# PS Vita hardware fixes

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
