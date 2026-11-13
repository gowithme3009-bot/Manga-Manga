const clean = value => String(value || "")
  .replace(/https?:\/\/\S+/g, "")
  .replace(/[#*_]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const CHARACTER_HINTS = [
  { pattern: /\bnaruto\b/i, name: "Naruto Uzumaki", details: "spiky blond hair, blue eyes, three whisker-like marks on each cheek, Konoha forehead protector, recognizable orange-and-black ninja outfit" },
  { pattern: /\bsasuke\b/i, name: "Sasuke Uchiha", details: "dark spiky hair, dark eyes, recognizable Uchiha character design and outfit appropriate to the requested era" },
  { pattern: /\bone piece\b|\bluffy\b/i, name: "Monkey D. Luffy", details: "short black hair, straw hat, small scar under the left eye, recognizable red vest and signature silhouette" },
  { pattern: /\bgoku\b|\bdragon ball\b/i, name: "Son Goku", details: "distinctive upright black spiky hair, martial-arts gi, recognizable silhouette and facial features" },
  { pattern: /\bichigo\b|\bbleach\b/i, name: "Ichigo Kurosaki", details: "distinctive orange hair, recognizable facial features and shinigami clothing when appropriate" },
  { pattern: /\bnezuko\b/i, name: "Nezuko Kamado", details: "long dark hair with orange tips, pink kimono, bamboo muzzle only if appropriate to the requested scene" }
];

function identifyCharacter(text) {
  return CHARACTER_HINTS.find(item => item.pattern.test(text)) || null;
}

export function buildMasterImagePrompt(draft, mode = "creative") {
  const title = clean(draft?.title).slice(0, 180);
  const body = clean(draft?.body).slice(0, 420);
  const source = title + " " + body;
  const character = identifyCharacter(source);
  const fidelity = mode === "fidelity";
  const identity = character
    ? "Character to depict: " + character.name + ". Preserve these recognizable canonical visual traits: " + character.details + "."
    : "Depict the named manga/anime character from the subject faithfully; if the identity is ambiguous, do not invent a specific design.";
  const style = fidelity
    ? "High character fidelity is the top priority. Keep the character's recognizable face, hairstyle, colors, outfit, accessories and proportions consistent. The requested emotion or action must be clear. Do not redesign, replace, genericize or merge the character with another character."
    : "Creative editorial scene with artistic freedom in pose, environment, lighting and framing, while keeping the named character recognizable and preserving their signature traits.";
  return [
    "Create a polished square 1:1 manga/anime editorial illustration for a French manga and anime news Facebook post.",
    "Publication subject: " + title + ".",
    "Visual context: " + body + ".",
    identity,
    style,
    "Expressive readable emotion, coherent anatomy, clean detailed rendering, strong focal point, cinematic lighting.",
    "No text, no letters, no logo, no watermark, no interface, no collage."
  ].join(" ");
}
