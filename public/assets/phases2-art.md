# Atlas da campanha — Fases 4, 5 e 6

Ferramenta: geração de imagens integrada (ImageGen) com refinamento e segmentação alpha transparente (1254 × 1254 px).
Arquivo final: `public/assets/phases2.webp` e `dist/assets/phases2.webp`.
Recortes definidos em `src/sprites.js` no mapa `PHASE2_BOUNDS`.

Grade: 3 colunas × 3 linhas (células de 418 × 418 px).
- **Colunas:** Inimigo comum / atirador / combatente, inimigo rápido / voador, chefe da fase.
- **Linhas:**
  1. Pântano Espectral (Swamp): `spore`, `revenant`, `bogwarden`
  2. Cidadela Astral (Astral): `sentinel`, `seer`, `archon`
  3. Eclipse do Vazio (Void): `voidling`, `voidscarab`, `umbra`

## Prompt final

Use case: stylized-concept. Asset type: production sprite atlas for a top-down pixel-art fantasy survival game, square sprite sheet with exactly 3 columns and 3 rows of equal-sized cells on a clean transparent background, matching the exact pixel art style, proportions, and top-down perspective of the reference image. Each creature is centered in its cell with transparent margins, fully contained within its cell boundary. Crisp richly shaded pixel art, three-quarter front view, matching classic chibi fantasy wizard games.
Row 1 (Spectral Swamp):
- Col 1: toxic swamp spore mushroom monster with glowing violet and green spore caps and small glowing eyes (`spore`)
- Col 2: floating ghostly swamp revenant wraith with wispy pale cyan-green ethereal tendrils (`revenant`)
- Col 3: imposing bog warden matriarch boss, a colossal swamp monstrosity of mossy roots, vines, and bioluminescent swamp blooms (`bogwarden`)
Row 2 (Astral Citadel):
- Col 1: radiant solar sentinel knight in polished celestial gold plate armor with sun crest helm and solar shield (`sentinel`)
- Col 2: floating astral seer mystical eye sphere encircled by orbiting celestial gold rings and starlight sparks (`seer`)
- Col 3: magnificent crowned solar archon boss with grand radiant glowing angel wings and solar halo (`archon`)
Row 3 (Void Eclipse):
- Col 1: agile cosmic voidling shadow bat with dark purple nebula wings and glowing magenta eyes (`voidling`)
- Col 2: armored obsidian void scarab beetle with glowing cosmic violet cracks and sharp mandibles (`voidscarab`)
- Col 3: towering cosmic void sovereign Umbra boss enveloped in dark matter tentacles, eclipse crown, and a glowing violet singularity core (`umbra`)

## Recortes (1254 × 1254 px)

```javascript
const PHASE2_BOUNDS = {
  spore: [0, 0, 418, 418], revenant: [418, 0, 418, 418], bogwarden: [836, 0, 418, 418],
  sentinel: [0, 418, 418, 418], seer: [418, 418, 418, 418], archon: [836, 418, 418, 418],
  voidling: [0, 836, 418, 418], voidscarab: [418, 836, 418, 418], umbra: [836, 836, 418, 418]
};
```
