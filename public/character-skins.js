// Built-in skins use the existing image field, keeping saved configurations
// compatible with the running bridge and with export/import.
export const characterSkins = [
  { id: 'original', name: 'Original', url: 'assets/mascot-blue.webp' },
  { id: 'pink-antennas', name: 'Rosa · anteninhas', url: 'assets/skin-rosa-antenas.webp' },
  { id: 'blue-horns', name: 'Azul · chifrinhos', url: 'assets/skin-azul-chifres.webp' },
  { id: 'holographic-bat', name: 'Morceguinho · holográfico', url: 'assets/skin-morcego-holografico.webp' }
];
let cached;
const skinIdBySprite = new Map();
export function characterSkinId(sprite) { return skinIdBySprite.get(sprite) || ''; }
// Palette hues are relative to the original blue mascot. Each raster skin
// starts at its own color, so apply the palette as a relative shift.
export function characterHue(agent) {
  const base = { 'pink-antennas': 100 }[characterSkinId(agent.sprite)] || 0;
  return (agent.hue ?? 0) - base;
}
export function loadCharacterSkins() {
  if (!cached) cached = Promise.all(characterSkins.map(async skin => {
    if (skin.id === 'original') return { ...skin, sprite: '' };
    const response = await fetch(skin.url);
    if (!response.ok) throw new Error('Não foi possível carregar as skins. Atualize o painel.');
    const blob = await response.blob();
    const sprite = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { ...skin, sprite };
  })).then(skins => {
    for (const skin of skins) if (skin.sprite) skinIdBySprite.set(skin.sprite, skin.id);
    return skins;
  }).catch(error => { cached = undefined; skinIdBySprite.clear(); throw error; });
  return cached;
}
