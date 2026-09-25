# Spritesheets animados da web

As 29 folhas em `public/assets/animated/` foram geradas pelo modelo de imagem a partir de `public/assets/sprites.webp`, `phases.webp`, `phases2.webp` e das imagens individuais de Developer, Aurora e The God. Cada folha tem 4 colunas × 5 linhas (repouso, movimento, ataque, interação, dano), com 4 quadros por estado e transparência real. As variantes cromáticas reaproveitam as poses geradas e são recoloridas uma vez pelo cliente.

Instrução comum aos prompts: preservar a identidade visual do personagem ou inimigo indicado na imagem de referência; criar poses novas quadro a quadro, com mudanças reais de anatomia, roupa e efeitos; manter escala e alinhamento consistentes em células iguais; não incluir texto, grade, chão ou fundo opaco. Os ataques foram descritos para cada criatura (por exemplo, feitiço de fogo do mago vermelho, investida do besouro e golpe de raízes do treant).

Os PNGs originais produzidos pelo modelo foram convertidos para WebP sem perdas e reduzidos para 512 × 640 px com FFmpeg, mantendo 128 × 128 px por quadro. A conversão não cria poses. O jogo carrega apenas a folha de cada entidade quando ela aparece; os ports de console continuam usando a arte anterior.
