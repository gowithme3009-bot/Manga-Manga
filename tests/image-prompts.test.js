import test from "node:test";
import assert from "node:assert/strict";
import { buildMasterImagePrompt } from "../js/image-prompts.js";

test("mode fidélité décrit les traits reconnaissables de Naruto", () => {
  const prompt = buildMasterImagePrompt({ title: "Naruto qui pleure", body: "Une scène émotionnelle." }, "fidelity");
  assert.match(prompt, /Naruto Uzumaki/);
  assert.match(prompt, /three whisker-like marks/);
  assert.match(prompt, /High character fidelity is the top priority/);
  assert.match(prompt, /requested emotion or action must be clear/);
});

test("mode créativité conserve l'identité tout en laissant la scène libre", () => {
  const prompt = buildMasterImagePrompt({ title: "Luffy au coucher du soleil", body: "Une scène d'aventure." }, "creative");
  assert.match(prompt, /Monkey D\. Luffy/);
  assert.match(prompt, /Creative editorial scene with artistic freedom/);
  assert.match(prompt, /straw hat/);
});

test("les sujets non reconnus ne reçoivent pas de détails de personnage inventés", () => {
  const prompt = buildMasterImagePrompt({ title: "Un manga inconnu", body: "Une scène mystérieuse." }, "fidelity");
  assert.match(prompt, /if the identity is ambiguous, do not invent a specific design/);
  assert.doesNotMatch(prompt, /Naruto Uzumaki|Monkey D\. Luffy/);
});
