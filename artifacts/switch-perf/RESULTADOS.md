# Teste de hordas no Sudachi — 19/09/2026

**Histórico de uma tentativa revertida.** Após o usuário relatar queda de FPS justamente quando a resolução
diminuía, o canvas intermediário e a resolução adaptativa foram removidos. O port voltou a desenhar diretamente
em 720p. Os números abaixo documentam o experimento em CPU no emulador, não o desempenho da build atual
nem uma melhora comprovada no Switch real. O smoke atual verifica desenho direto nos antigos limites de horda.

Sudachi 1.0.15 indicado pelo usuário, renderer nx.js CPU, build debug, 180 inimigos (90 cogumelos + 90 besouros),
seed 12345, personagens parados e HP elevado. Sem redução no número de entidades. Foram executados solo e co-op.

Média dos registros de segundos 10 a 15, após o carregamento inicial:

| Modo | Render anterior | Render adaptativo | Redução |
| --- | ---: | ---: | ---: |
| Solo | 195,0 ms | 153,3 ms | 21,4% |
| Co-op | 380,4 ms | 299,5 ms | 21,3% |

Os tempos de frame suavizados nessa janela foram 264,0 → 209,6 ms (solo) e 421,3 → 338,7 ms (co-op).
O cenário ainda fica muito lento neste estresse em CPU; estes números não demonstram 60 FPS.
As execuções têm a mesma população e semente, mas não são um replay de frames idênticos: a simulação limita o passo
em frames lentos. São amostras curtas, sujeitas a aquecimento/JIT e variação do emulador, sem garantia do mesmo ganho no console.

O campo FPS do primeiro log ainda usava média exponencial de FPS instantâneo, com valor inicial 60, e converge
lentamente. O profiler final usa frames/tempo em janelas de aproximadamente um segundo. A comparação acima utiliza
os tempos de render, cujo método não mudou. O limite de dt da simulação já havia sido separado da medição em ambas as builds.

Logs: `baseline-cpu.log`, `adaptive-cpu.log`. Capturas: `baseline-solo.png`, `adaptive-solo.png`.
As capturas mostram a diferença de nitidez; não representam o mesmo instante da simulação.

## Otimização Direta em 720p (Direct Axis-Aligned Blit) — 19/09/2026

Com a resolução mantida nativamente em 720p (sem downscaling adaptativo e sem canvas intermediário), foram implementadas as seguintes otimizações estruturais:
1. **Fast-path axis-aligned em `drawSprite`**: elimina as duas chamadas a `ctx.setTransform` e `worldTransform(ctx)` para todos os sprites alinhados, usando espelhamento pré-gerado em cache.
2. **`fastCrowdSprites` em `animator.pose`**: remove a micro-rotação de 1–2 graus e a deformação de 1,5% dos inimigos comuns de horda, preservando 100% da física, pulo vertical de caminhada, direções, flashes de dano e exclamações. Chefes e elites continuam com animações completas.
3. **Quantização de fontes de dano**: elimina strings dinâmicas de ponto flutuante em `ctx.font` e adiciona guard de igualdade em `installFontCompat`.
4. **Zero-closure na separação de inimigos**: reaproveitamento estático de callbacks em `server/enemies.js`.

### Medições no Sudachi 1.0.15 (Renderer CPU, 180 inimigos, média t=10..15s):

| Modo | Baseline 720p anterior | Otimizado 720p Direto | Redução |
| --- | ---: | ---: | ---: |
| **Co-op (Tela Dividida)** | **380,4 ms** | **256,8 ms** | **-32,5%** |
| Frame total (Co-op) | 421,3 ms | 331,6 ms | -21,3% |

Logs comparativos: `baseline-cpu.log`, `optimized-coop.log`.
