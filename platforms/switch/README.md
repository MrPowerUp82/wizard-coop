# Arcana Survivors — Nintendo Switch (homebrew `.nro`)

Port do jogo para Nintendo Switch com [nx.js](https://nxjs.n8.io). Roda o **mesmo** jogo da versão web:
solo, desafio diário e o **co-op local em tela dividida que já existia**, agora com Joy-Cons separados.

| Pacote | Versão usada |
| --- | --- |
| `@nx.js/runtime` (tipos do runtime) | **1.0.0-beta.6** |
| `@nx.js/nro` (empacotador, runtime embutido) | **1.0.0-beta.6** |
| `@nx.js/constants` | **0.4.1** |
| `esbuild` | 0.28.2 |

As versões são fixas em `platforms/switch/package.json`. Tudo o que o port usa foi conferido na tipagem e no
código-fonte do nx.js 1.0.0-beta.6 (e o código Switch passa por `tsc` contra `@nx.js/runtime`).

## Gerar o `.nro`

Requisitos: Node.js 22+ e as dependências da raiz (`npm install`, que traz as fontes usadas também na web).

```bash
npm run switch:install
```

```bash
npm run switch:nro
```

O arquivo sai em **`platforms/switch/ArcanaSurvivors.nro`** (~59 MB: o runtime nx.js vai embutido, “fat”, e o jogo roda
sem instalar mais nada). Ele usa o renderer padrão do nx.js (GPU no modo aplicação), pensado para o console.

**Emuladores (Sudachi/yuzu):** use o NRO com renderer de CPU, veja [Renderer](#renderer):

```bash
npm run switch:nro:emu
```

Sai em `platforms/switch/ArcanaSurvivors-emu.nro`. Builds com o painel de depuração de controles:
`npm run switch:nro:debug` (console) e `npm run switch:nro:debug:emu` (emulador).

Outros comandos (dentro de `platforms/switch`): `npm run build` só gera `romfs/`; `npm run nro:slim` gera um NRO
pequeno que baixa/usa o runtime compartilhado em `sdmc:/nx.js/`; `npm run check` roda typecheck + testes.

O que o build faz (`build.mjs`):

1. esbuild empacota `src/main.js` em `romfs/main.js`, trocando `src/platform.js` (web) por `platforms/switch/src/platform.js`;
2. copia `public/assets/*.webp` (os mesmos atlas da web) para `romfs/assets/`;
3. converte Inter e Cinzel de `@fontsource` (WOFF, as fontes da web) para TTF em `romfs/fonts/`, copia a DejaVu Sans
   (símbolos que a Inter não tem) e as licenças das três fontes;
4. grava `romfs/nxjs.ini` com o renderer (`--renderer=auto|gpu|cpu`, padrão `auto`);
5. `nxjs-nro` junta `romfs/`, `icon.jpg` e o `package.json` (título “Arcana Survivors”, versão, autor) no `.nro`.

## Instalar e abrir

1. Copie `ArcanaSurvivors.nro` para `sdmc:/switch/` no cartão SD (console com CFW, p. ex. Atmosphère).
2. Abra o **Homebrew Menu** e escolha **Arcana Survivors**.
   - **Recomendado:** abra o Homebrew Menu segurando **R** ao iniciar um jogo (*title override*). É o “modo aplicação”
     do nx.js: JIT do V8 e canvas na GPU.
   - Pelo Álbum (“modo applet”) o nx.js usa interpretador sem JIT e renderização por CPU, com bem menos memória:
     funciona, mas deve ficar mais lento (veja *Validação em hardware*).
3. Na primeira vez o console pede um **perfil de usuário**: o progresso (Grimório, moedas, Códex, preferências) fica no
   save data desse perfil via `localStorage` do nx.js.

O botão **+** pausa a partida (no nx.js ele fecharia o app; o jogo cancela isso). Para sair use **Sair** no menu.

## Controles

As ações são as mesmas da web (teclado → controle):

| Ação | Web | Joy-Con L (horizontal) | Joy-Con R (horizontal) | Pro Controller / portátil |
| --- | --- | --- | --- | --- |
| Mover | WASD / setas | analógico | analógico | analógico esquerdo |
| Especial | Espaço / Enter | **SL** ou botão ▶ | **SL** ou **X** | A, R ou ZR |
| Esquiva | Shift | **SR** ou botão ▼ | **SR** ou **A** | B, L ou ZL |
| Pausar | Esc | **−** | **+** | + ou − |
| Confirmar (menus) | clique / 1-2-3 | botão ▶ | X | A |
| Voltar | — | botão ▼ | A | B |
| Trocar opções de poder | R | botão ▲ | Y | Y ou X |

Com o Joy-Con deitado, “▶/▼/▲” são as setas impressas nos botões do Joy-Con L como o jogador as vê (o botão da
direita, o de baixo e o de cima). Nos menus o analógico (e o D-pad do Pro Controller) navega.

### Co-op local (tela dividida)

1. Separe os Joy-Cons como dois controles: **HOME › Controles › Mudar empunhadura/ordem** (em inglês, *Change Grip/Order*), segure **cada** Joy-Con na
   horizontal e pressione **SL + SR** nele. (O nx.js 1.0.0-beta.6 não expõe API para fazer isso de dentro do app;
   este é o fluxo do próprio sistema.)
2. No jogo: **Co-op local**. O lobby associa **Joy-Con L → Jogador 1** e **Joy-Con R → Jogador 2** automaticamente e
   mostra “✓ conectado”. Outros controles (dois Pro Controllers, por exemplo) entram na ordem do console; um controle
   sem jogador entra pressionando **SL + SR** ou **A**. **Y / ▲** troca os controles de lugar.
3. Cada jogador escolhe o personagem com o próprio controle e confirma; quando os dois estão prontos a partida começa.

Se os dois Joy-Cons aparecerem como **um** controle (“Par de Joy-Cons”), o lobby mostra a instrução do passo 1.

**Desconexão:** se o controle de um jogador cai, a partida pausa com “Controle do Jogador N desconectado”. Quando o
mesmo controle volta (reconhecido pelo `Gamepad.id`, nome + número de série), ele reassume o jogador; outro controle
livre também pode assumir com SL + SR / A. O jogador não é recriado: vida, XP, armas, poderes, personagem e
estatísticas continuam os mesmos.

## Arquitetura do port

O co-op local e a tela dividida **não foram reimplementados**. O código que já existia em `src/main.js` foi movido,
sem mudar o comportamento, para módulos que a web e o Switch usam juntos:

| Existente (web) | Onde está agora | Uso no Switch |
| --- | --- | --- |
| Criação da partida offline (solo, diário, tela dividida com `local = ['me', 'p2']`) | `src/localCoop.js` → `createOfflineRun` | igual |
| Input por slot → `player.input`, simulação **uma vez por frame** para todos | `advanceOfflineRun` | igual; o Switch só fornece `read(slot)` |
| Regra de quem pode agir / escolher poder | `offlineActor`, `chooserOf` | igual |
| Decisão 1 jogador = tela cheia / 2 = metades, câmera por jogador, painel por jogador | `renderLocalViews` (+ `splitHud.js`) | igual, com `W×H` = `screen.width × screen.height` (1280×720) |
| Eventos → sons, anúncios, Códex | `src/feedback.js` | igual, com HUD em canvas |
| Canvas offscreen e URLs de assets | `src/platform.js` | trocado no build por `platforms/switch/src/platform.js` |

Sem alterações: `server/*` (simulação, inimigos, chefes, armas, poderes, drops, colisões, ondas, RNG),
`src/render.js`, `src/animation.js`, `src/audio.js`, `src/music.js`, `src/wallet.js`, `src/codex.js`;
`src/sprites.js`/`terrain.js` só passaram a pedir canvas e URLs a `platform.js`. O renderer é somente leitura em relação à simulação (desenha o mesmo
mundo duas vezes na tela dividida sem alterar HP, posições, cooldowns, XP, drops ou o RNG do jogo).

Específico do Switch (`platforms/switch/src/`):

- `input/mappings.js` — **todo** o mapeamento: classificação por `styleSet`, normalização dos eixos dos Joy-Cons
  deitados (`normalizeJoyConLeftAxes` / `normalizeJoyConRightAxes`), botões por ação usando `HidNpadButton` de
  `@nx.js/constants` (SL/SR só existem em `Gamepad.rawButtons`), rótulos e preferência L→J1 / R→J2;
- `input/controllers.js` — mesmo contrato do `src/input.js` da web (`read(slot)`, `onSpecial/onDash/onPause(slot)`),
  associação slot ↔ controle por `Gamepad.id`, conexão/desconexão;
- `ui/` — menus, HUD, escolha de poder, pausa e resultados em canvas (a web usa DOM); as regras vêm dos módulos
  existentes (personagens, campanhas, Grimório, desafio diário, mesmas chaves de preferência);
- `fonts.js` — no nx.js um `ctx.font` com família não registrada é ignorado e cada texto usa uma única fonte (sem
  fallback por glifo); as fontes da web são registradas, cada `font` é normalizado para uma face registrada e textos
  com símbolos que a Inter não tem (ícones de poderes, ◀ ▶ ● ✓) são desenhados com DejaVu Sans;
- `audio-compat.js` — o nx.js 1.0.0-beta.6 declara `createOscillator()`/`createBiquadFilter()`, mas eles lançam
  “Method not implemented”. Osciladores e filtros viram *buffers* renderizados em JS (com cache) tocados por
  `AudioBufferSourceNode` pelos mesmos `GainNode`s: `audio.js`/`music.js` rodam sem mudança. Cada nota é
  desconectada ao terminar: o grafo nativo do nx.js mantém (e mixa) nós conectados para sempre, o que deixava o jogo
  mais lento a cada segundo;
- `canvas-compat.js` — no nx.js, `fill()` de um path com gradiente radial não desenha nada (CPU e GPU); os brilhos
  do jogo usam isso, então esse `fill()` vira `clip()` + `fillRect()` (mesmos pixels);
- `debug/` — painel de controles, profiler e *autoplay* de medição (só em build debug).

O co-op online (servidor, protocolo, mensagens, WebSocket) não mudou e continua na web; ele não foi portado para o Switch.

## Depuração

`npm run switch:nro:debug` (ou `DEBUG_CONTROLLERS=true npm run switch:build`) liga:

- **CONTROLLER DEBUG** (canto direito): por controle, `id`, tipo detectado, `styleSet` e `deviceType` com os nomes
  das flags, `connected`, `axes 0..3`, `rawButtons`, botões brutos (A, B, X, Y, L, R, ZL, ZR, Plus, Minus, Stick,
  D-pad, LeftSL, LeftSR, RightSL, RightSR), `buttons[]` no formato web e o **`moveX`/`moveY` normalizado** que o jogo
  recebe. Clique um analógico para mostrar/ocultar; na tela **Controles** ele aparece sempre.
- **Profiler** (canto esquerdo): FPS, tempo de frame, update e render (ms), inimigos, projéteis, jogadores, controles
  conectados e heap JS.

Na build normal esse código nem entra no bundle.

No PC: `npm run switch:check` (typecheck contra os tipos do nx.js, teste da camada de áudio e teste de fumaça do bundle
real com Joy-Cons simulados) e, com `npm run dev` rodando, `http://localhost:5173/platforms/switch/dev/index.html`
abre o bundle do Switch no navegador em 1280×720 com Joy-Cons simulados pelo teclado (veja a página). Depois de
`npm run switch:build:debug`, reinicie o `npm run dev` (ele não observa `platforms/`).

## Renderer

O nx.js tem dois renderers de canvas (`romfs/nxjs.ini`, `[renderer] mode`): GPU (Skia na GPU, padrão no modo
aplicação) e CPU (raster).

Medido no Sudachi 1.0.15 (Vulkan, GPU Intel), com o autoplay da build debug:

| | GPU | CPU |
| --- | --- | --- |
| Solo | ~60 FPS (render ~5 ms) | ~50–60 FPS (render ~11–16 ms) |
| Co-op (2 viewports) | ~55 FPS (render ~9–14 ms) | ~30–40 FPS (render ~20–30 ms) |
| Imagem | **incorreta**: traços somem (juntas arredondadas, traços com alpha, polígonos fechados), aparecem cunhas e linhas partindo de (0,0) | correta |

Um diagnóstico com cada primitivo do renderer mostrou que, no Sudachi, só o caminho de GPU falha. O mesmo código em
CPU e no navegador sai certo. Por isso `ArcanaSurvivors.nro` usa o padrão (`auto`), pensado para o console, e
`ArcanaSurvivors-emu.nro` usa CPU. Se o console real mostrar os mesmos defeitos, gere com
`npm run switch:build -- --renderer=cpu` antes do `nro` (veja *Validação em hardware*).

**Autoplay (build debug):** crie `sdmc:/arcana-autoplay.json`, por exemplo
`{"steps":[{"mode":"coop","seconds":20},{"mode":"solo","seconds":20}]}`, e abra a build debug. Cada etapa joga sem
controle, grava FPS, tempos de update/render, inimigos e memória por segundo em `sdmc:/arcana-autoplay.log`, salva
`sdmc:/arcana-autoplay-<n>.png` e o app fecha no fim. `"disable": ["terrain" | "gradients" | "text" | "shadow" |
"lighter" | "roundfont"]` desliga um recurso naquela etapa, para medir o custo dele.

## Alterar o mapping

Tudo fica em `platforms/switch/src/input/mappings.js`:

- `ACTIONS` — máscara de botões (`HidNpadButton`) de cada ação por tipo de controle;
- `JOYCON_FACES` — qual botão frontal está à direita/embaixo/à esquerda/em cima com o Joy-Con deitado;
- `JOYCON_STICK_FRAME` — `'device'` (o jogo gira o analógico) ou `'system'` (o sistema já entrega girado);
- `COOP_PREFERENCE` — quais tipos viram Jogador 1 e 2 por padrão;
- `LABELS` — nomes exibidos nos painéis e menus.

## Validação em hardware

O port foi validado no PC (typecheck contra o nx.js, testes headless do bundle, harness no navegador), mas **não em
um Switch real**. Os itens abaixo dependem de como o console reporta os controles.

**HARDWARE VALIDATION REQUIRED — Joy-Cons como dois controles**
- Arquivo/função: `input/mappings.js` → `classifyPad`; `input/controllers.js` → `autoAssign`.
- Esperado: após “Mudar empunhadura/ordem” com SL+SR em cada Joy-Con, o painel mostra dois controles: um com
  `style: 8 (JoyLeft)` / `type: 16 (JoyLeft)` e outro com `style: 16 (JoyRight)` / `type: 32 (JoyRight)`, em índices
  diferentes (normalmente 0 e 1). O lobby mostra Joy-Con L como Jogador 1 e Joy-Con R como Jogador 2.
- Como testar: build debug → **Controles**. Se aparecer `style: 4 (JoyDual)`, os Joy-Cons continuam combinados.

**HARDWARE VALIDATION REQUIRED — direção do analógico com o Joy-Con deitado**
- Arquivo/função: `input/mappings.js` → `normalizeJoyConLeftAxes`, `normalizeJoyConRightAxes`, `JOYCON_STICK_FRAME`.
- Esperado: com cada Joy-Con na horizontal (trilho SL/SR para cima), empurrar o analógico para a **direita do jogador**
  mostra `moveX: 1.00, moveY: 0.00`; para **cima**, `moveX: 0.00, moveY: -1.00`.
- Como testar: build debug, painel de controles. Se os valores saírem girados 90° (direita vira cima/baixo), o sistema
  já entrega o analógico girado: mude `JOYCON_STICK_FRAME` para `'system'`. Os eixos brutos (`axes 0..3`) mostram a
  origem: Joy-Con L usa `axes 0/1`; Joy-Con R usa `axes 2/3`.

**HARDWARE VALIDATION REQUIRED — SL e SR**
- Arquivo: `input/mappings.js` → `ACTIONS.joyLeft` / `ACTIONS.joyRight` (`LeftSL`, `LeftSR`, `RightSL`, `RightSR`).
- Esperado: SL acende `raw: LeftSL` (Joy-Con L) ou `raw: RightSL` (Joy-Con R) e `SL: ●`; na partida, SL lança o
  especial e SR faz a esquiva **só** do jogador daquele Joy-Con.

**HARDWARE VALIDATION REQUIRED — botões frontais deitados**
- Arquivo: `input/mappings.js` → `JOYCON_FACES`.
- Esperado: o botão da **direita** confirma (Joy-Con L: `raw: Down`; Joy-Con R: `raw: X`) e o de **baixo** volta
  (Joy-Con L: `raw: Left`; Joy-Con R: `raw: A`). Se o console já reportar os botões girados, ajuste `JOYCON_FACES`.

**HARDWARE VALIDATION REQUIRED — reconexão**
- Arquivo/função: `input/controllers.js` → `poll`, `padFor`; `main.js` → `overlayInput`.
- Esperado: desligar o Joy-Con R pausa com “Controle do Jogador 2 desconectado”; religá-lo (SL+SR se o console
  pedir) mostra “reconectado” com o **mesmo** `id` e o Jogador 2 volta a responder a ele, sem perder nada.
- Se o `id` mudar (firmware < 5.0.0 usa `switch-gamepad-<índice>`), pressione SL+SR/A no controle religado.

**HARDWARE VALIDATION REQUIRED — renderer de GPU**
- Arquivo: `romfs/nxjs.ini` (gerado por `build.mjs`, `--renderer`).
- Esperado: no console, `ArcanaSurvivors.nro` (GPU) desenha igual ao navegador: anéis e sigilos, raios em
  zigue-zague, luas crescentes e o rastro do meteoro, sem polígonos brancos nem linhas saindo do canto da tela.
- Se aparecerem os mesmos defeitos do Sudachi, use o renderer de CPU (seção *Renderer*).

**HARDWARE VALIDATION REQUIRED — desempenho, áudio e fontes**
- Profiler da build debug: FPS e `render` em solo e em tela dividida, em modo aplicação (R + jogo) e pelo Álbum.
- Áudio (`audio-compat.js`): efeitos e trilha devem soar como na web; a primeira nota de cada tipo é renderizada em JS
  (pode haver engasgo no início, sobretudo sem JIT).
- Fontes (`fonts.js`): textos com acentos em Inter/Cinzel; ícones e símbolos em DejaVu Sans. Três glifos que nenhuma
  fonte embutida tem são trocados: ᛭ → ✱, ᛉ → Ψ, ⛨ → ✠.

## Limitações conhecidas

- **Joy-Cons separados dependem do sistema:** nx.js 1.0.0-beta.6 configura os estilos JoyLeft/JoyRight
  (`HidNpadStyleSet_NpadStandard`), mas não chama `hidSetNpadJoyAssignmentModeSingleByDefault` nem
  `hidSetNpadJoyHoldType`, e não expõe o *AppletResourceUserId* que esses comandos IPC exigem. Por isso a separação é
  feita em HOME › Controles. Se isso não bastar no seu console, a extensão mínima seria no runtime nx.js
  (`source/main.cc`, logo após `padConfigureInput`): chamar `hidSetNpadJoyHoldType(HidNpadJoyHoldType_Horizontal)` e
  expor `hidSetNpadJoyAssignmentModeSingleByDefault(id)` ao JS — exige recompilar o nx.js com devkitPro (não incluso).
- Co-op **online** não está no Switch (a web continua com online completo).
- No Switch: sem seleção de maldições, arma inicial ou especial alternativo, e sem tela do Códex (as descobertas
  continuam sendo registradas). O co-op local tem 2 jogadores, como a tela dividida existente.
- No Sudachi, o renderer de GPU desenha errado (seção *Renderer*); o NRO de emulador usa CPU e fica mais lento no co-op
  (~30–40 FPS medidos). A escolha de poder e a pausa sobre a tela dividida custam mais (~20 FPS no emulador em CPU).
