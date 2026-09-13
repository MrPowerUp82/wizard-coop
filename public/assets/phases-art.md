# Atlas da campanha

Ferramenta: geração de imagens integrada (ImageGen); sem CLI. Arquivo final: `phases.png`, PNG com alpha, 1254 × 1254. Os recortes ajustados à arte estão em `src/main.js` no mapa `phaseSprites`. O atlas original foi preservado.

Colunas: inimigo terrestre, inimigo rápido, chefe. Linhas: bosque, gelo, brasas. Os pisos são gerados separadamente em Canvas no navegador.

## Prompt final

Use case: stylized-concept. Asset type: production sprite atlas for a top-down pixel-art fantasy survival game. Create one square PNG sprite sheet on a genuinely transparent background with exactly 3 columns and 3 rows of equal-sized cells, no gutters between cells. Each creature centered in its cell, its entire body inside the central 80% with transparent margins, nothing crossing cell boundaries. Crisp richly shaded pixel art, three-quarter front view, matching classic chibi fantasy wizard games. Row 1 forest: col 1 emerald mushroom monster, col 2 thorny wood beetle, col 3 massive ancient treant boss with antler branches and emerald core. Row 2 frozen crypt: col 1 icy skeleton swordsman, col 2 floating cyan wraith, col 3 imposing crowned frost lich boss with crystalline staff. Row 3 volcanic abyss: col 1 small red ember imp, col 2 black obsidian scorpion with orange cracks, col 3 huge horned lava demon boss. Bosses visually impressive but entirely within their own cells. Strong silhouettes readable at 64px. No text, labels, grid lines, floor, shadows outside silhouettes, or checkerboard. Real alpha transparency.
