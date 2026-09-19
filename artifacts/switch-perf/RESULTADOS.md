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

As tentativas de diminuir texturas ou simplificar as poses não produziram ganho consistente e foram descartadas.
As animações originais foram preservadas. O teste final inclui ainda uma execução com renderer `auto`, registrada
em `adaptive-auto.log`, sem baseline equivalente nesse renderer.

Validação: lint, typecheck, 119 testes do jogo, typecheck do Switch, áudio, smoke do bundle e regressão do profiler.
O smoke verifica 360p/540p/720p e a margem de troca de resolução em tela dividida.
