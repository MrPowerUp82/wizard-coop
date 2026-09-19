# Otimizações de performance — Switch e PS Vita

Este branch mantém as regras, spawns, inimigos, bosses, armas, dano, XP e progressão da versão web. As mudanças abaixo atacam custo de CPU/GPU e coleta de lixo dos ports.

## Núcleo compartilhado

- Limpeza de arrays quentes (`enemies`, `gems`, `shots`, `runes`, `zones`, `events`) agora é feita **in-place**, evitando `filter().slice()` e arrays temporários conforme a horda cresce.
- A grade espacial recicla buckets entre ticks em vez de recriar arrays continuamente.
- Busca de alvo mais próximo de armas foi convertida para passagem única quando não é necessário ordenar toda a lista.
- O sistema de animação reutiliza poses e pequenos objetos temporários. Em split-screen a pose de cada ator é calculada uma vez por update e reutilizada pelas duas viewports.

## Nintendo Switch

A versão web continua com a apresentação completa. O Switch usa a mesma simulação e o mesmo conteúdo, mas o rastro de projéteis usa duas passagens sólidas com a mesma cor/silhueta no lugar de criar um `CanvasGradient` novo para cada projétil em cada viewport.

Isso ataca o caso em que o jogo começa fluido e degrada à medida que a quantidade de inimigos e projéteis aumenta, sem reduzir limites de inimigos ou frequência de spawn.

Use a build de debug para validar em hardware:

```bash
npm run switch:nro:debug
```

O profiler já existente mostra FPS, `update ms`, `render ms`, entidades e heap.

## PlayStation Vita

O maior gargalo estava na compatibilidade Canvas sobre QuickJS/vita2d: círculos, linhas e retângulos simples eram convertidos em muitos triângulos em JavaScript, com vários buffers/arrays novos por desenho.

Agora:

- círculos preenchidos vão direto para `vita2d_draw_fill_circle`;
- linhas finas vão direto para `vita2d_draw_line`;
- retângulos sólidos vão direto para `vita2d_draw_rectangle`;
- linhas grossas e contornos circulares são montados nativamente em C;
- buffers genéricos de triângulos são reutilizados;
- paths/pontos de curvas são reciclados após o aquecimento;
- clipping/blend só atravessam a bridge JS→C quando o estado muda;
- `requestAnimationFrame` usa duas filas persistentes, sem clonar callbacks por frame;
- cada TTF é carregada apenas uma vez (o tamanho é argumento do draw no vita2d), em vez de uma cópia da fonte para cada tamanho de texto;
- o runtime usa CPU 444 MHz, BUS 222 MHz, GPU 222 MHz e XBAR 166 MHz;
- no Vita apenas, partículas atmosféricas de fundo são desativadas e sombras simples usam círculos. Efeitos de combate, bosses, ataques, HUD e gameplay continuam presentes.

Como `platforms/vita/runtime/src/main.c` foi alterado, o runtime nativo precisa ser recompilado com VitaSDK antes de gerar o VPK:

```bash
npm run vita:runtime
npm run vita:vpk
```

O empacotador verifica o hash do source e recusa um `eboot.bin` antigo.

## O que NÃO foi reduzido

- quantidade/limite de inimigos;
- frequência de spawn;
- dificuldade;
- dano/HP;
- quantidade de jogadores;
- resolução nativa da interface (o Switch agora reduz a resolução interna do cenário em hordas grandes; ver abaixo);
- bosses ou fases;
- simulação/tick rate.

A versão browser mantém `fastTrails: false`, atmosfera e sombras originais; portanto a apresentação original continua sendo a referência visual.

## Validação

Os testes do núcleo que não dependem do pacote externo `ws` passam após as mudanças (109 testes). As builds nativas `.nro`/`.vpk` ainda devem ser medidas em console real, pois este ambiente não possui devkitPro/nx.js CLI nem VitaSDK instalados.

## Nintendo Switch — segunda rodada (FPS em hordas)

Esta rodada mantém a simulação e a quantidade de entidades intactas e reduz principalmente custo de Canvas/Skia:

- glows radiais frequentes (partículas, familiar e zonas) são pré-renderizados uma vez e reutilizados como texturas no Switch;
- o piso usa macro-tiles 512×512 pixel-idênticos aos tiles 256×256 originais, reduzindo draw calls em split-screen;
- partículas atmosféricas de fundo ficam desativadas apenas no Switch;
- inimigos comuns sem dano não desenham uma barra de HP redundante; elites e inimigos feridos continuam mostrando HP;
- sombra individual de inimigo comum é omitida no Switch; elites, bosses e jogadores preservam a leitura de profundidade;
- leitura dos controles reutiliza arrays/objetos em vez de alocar novos a cada frame;
- `nxjs.ini` aumenta o orçamento do cache Ganesh para 128 MiB quando o renderer GPU está disponível.

### Importante: Application mode no Switch

Para desempenho máximo, abra o Homebrew Menu por **title override / full RAM** em vez do Album/applet mode. O nx.js 1.0 beta escolhe GPU + V8 JIT automaticamente em application mode; no regime applet ele prioriza raster/jitless por limitação de memória. O código continua usando `jit=auto` para não arriscar falta de memória no applet.

Build normal (auto):

```bash
npm run switch:nro
```

Build opcional forçando o renderer GPU para comparação em hardware:

```bash
npm run switch:nro:gpu
```

Se o GPU forçado não puder ser inicializado, use novamente a build `auto`. Para comparar corretamente, use a build debug e observe `update ms` versus `render ms` durante a mesma fase/horda.

## Nintendo Switch — resolução do cenário em hordas

O Switch reduz apenas a resolução interna do mundo para 540p/360p quando há 60/120 inimigos, com margem na volta
para evitar oscilações. A interface permanece nativa, e web/Vita mantêm seu caminho anterior. Não reduz entidades,
animações, simulação nem a área visível das câmeras. Existe perda de nitidez do cenário durante as hordas.

O profiler foi corrigido para medir o tempo real, sem o limite de 50 ms aplicado ao passo da simulação.
O autoplay agora permite uma horda reproduzível com `enemies` e `seed`, funciona sem controle e não deposita moedas.
Veja `artifacts/switch-perf/RESULTADOS.md` para a comparação no Sudachi; desempenho em Switch real ainda precisa de medição.
