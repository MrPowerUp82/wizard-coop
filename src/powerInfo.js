// Player-facing copy for every power: icon, name and what one more rank does.
export const POWER_INFO = {
  arcane: ['✦', 'Poder arcano', '+25% de dano mágico'],
  haste: ['ϟ', 'Cadência', 'Ataques 12% mais rápidos'],
  vitality: ['♥', 'Vitalidade', '+22 de vida máxima e cura 30'],
  swiftness: ['➤', 'Passos do vento', '+12% de velocidade'],
  multishot: ['✧', 'Disparo múltiplo', '+1 projétil por ataque'],
  magnet: ['◎', 'Magnetismo', '+55 de alcance de coleta'],
  armor: ['◇', 'Armadura rúnica', 'Reduz o dano recebido'],
  orbit: ['◉', 'Orbes arcanos', 'Orbes giram ao seu redor e ferem quem tocam'],
  aura: ['❂', 'Aura sagrada', 'Queima inimigos próximos a cada meio segundo'],
  chain: ['⚡', 'Corrente de raios', 'Um raio salta entre inimigos próximos'],
  runes: ['᛭', 'Runas explosivas', 'Deixa runas que explodem ao serem pisadas'],
  familiar: ['❖', 'Familiar arcano', 'Invoca um espírito que caça inimigos com o seu elemento'],
  shatter: ['❄', 'Estilhaço glacial', 'Inimigos lentos explodem em 4 estilhaços ao morrer'],
  burn: ['♨', 'Chão em chamas', 'Bolas de fogo deixam o chão queimando'],
  ricochet: ['↯', 'Ricochete', 'Espinhos saltam para o próximo inimigo'],
  boomerang: ['☾', 'Lua crescente', 'Lâminas voltam até você e ferem de novo'],
  bond: ['∞', 'Elo arcano', 'Você e aliados próximos atacam 8% mais rápido'],
  lifelink: ['❦', 'Vínculo vital', 'Aliados perto de você recuperam 2 de vida a cada 2s'],
  guardian: ['⛨', 'Guardião', 'Ressuscita aliados 50% mais rápido e com mais vida'],
  constellation: ['✺', 'Constelação', 'Evolução: +2 orbes maiores com o dobro de dano'],
  sanctuary: ['✚', 'Santuário', 'Evolução: aura maior que desacelera e cura aliados'],
  tempest: ['☈', 'Tempestade', 'Evolução: raios a cada segundo saltando 8 vezes'],
  minefield: ['✹', 'Campo minado', 'Evolução: três runas maiores por vez'],
  covenant: ['☬', 'Pacto ancestral', 'Evolução: familiar ataca mais rápido, mais forte e em mais alvos'],
  avalanche: ['❅', 'Avalanche', 'Evolução: estilhaços dobram para 8 e ferem mais'],
  hellfire: ['♆', 'Inferno', 'Evolução: chão em chamas maior, mais longo e mais quente'],
  bramble: ['⚘', 'Espinheiro', 'Evolução: espinhos atravessam +2 inimigos e ferem 15% mais'],
  fullmoon: ['◐', 'Lua cheia', 'Evolução: lâminas voltam maiores e com 60% mais dano'],
  stormrunes: ['ᛉ', 'Runas de tempestade', 'Evolução: cada explosão de runa lança um raio em 3 inimigos'],
  solarcrown: ['☀', 'Coroa solar', 'Evolução: orbes incendeiam inimigos e ferem 30% mais']
};

// Plain-language unlock requirement for every evolution, shown in choices and in the Códex.
export const requirementText = requires => Object.entries(requires || {})
  .map(([id, rank]) => `${POWER_INFO[id]?.[1] || id}${rank > 1 ? ` ${rank}` : ''}`).join(' + ');

export const DAMAGE_SOURCES = {
  spell: ['✦', 'Feitiço básico'], special: ['✺', 'Especial'], combo: ['✷', 'Combos'], convergence: ['✹', 'Convergência'],
  orbit: ['◉', 'Orbes'], aura: ['❂', 'Aura'], chain: ['⚡', 'Raios'], runes: ['᛭', 'Runas'], familiar: ['❖', 'Familiar'],
  burn: ['♨', 'Chão em chamas'], shatter: ['❄', 'Estilhaços'], boomerang: ['☾', 'Retorno lunar']
};

export const REACTIONS = {
  thermal: ['Choque térmico', 'Fogo atinge um inimigo desacelerado ou congelado.'],
  conduction: ['Condução', 'Raio atinge um inimigo preso em raízes.'],
  eclipse: ['Eclipse', 'Lâmina lunar atinge um inimigo em chamas.'],
  team: ['Combo em equipe', 'Um aliado finaliza o efeito que você aplicou: 2× de dano e carga de especial para os dois.'],
  convergence: ['Convergência', 'Dois arcanistas próximos usam o especial com até 1,5s de diferença: explosão entre eles.']
};

export const KIND_LABELS = { weapon: 'Arma', signature: 'Assinatura', coop: 'Co-op', evolution: 'Evolução', passive: '' };
