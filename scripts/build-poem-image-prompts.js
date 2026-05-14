#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const poemsDir = path.join(repoRoot, 'poems', 'content');
const manifestPath = path.join(repoRoot, 'poems', 'manifest.json');
const promptMarkdownPath = path.join(repoRoot, 'notes', 'poem-image-prompts.md');
const reviewDataPath = path.join(repoRoot, 'notes', 'poem-image-review-data.js');

const DEFAULT_CANDIDATE_ROOT = path.join(repoRoot, 'tmp', 'poem-image-candidates');
const DEFAULT_CANDIDATE_DIR = path.join(repoRoot, 'tmp', 'poem-image-candidates', 'pass-001');

const SPECS = [
  {
    slug: 'a-finger-two-dots-then-me',
    lines: [[120, 136]],
    context: 'The image should understand this as a cosmic love poem about reunion after death: specific directions through space, uncertainty about bodies, and recognition by light.',
    style: 'luminous, emotionally warm cosmic surrealism; let the composition breathe',
    avoid: 'avoid cartoon space art, literal gods, and visual text'
  },
  {
    slug: 'a-great-wagon',
    lines: [[14, 20]],
    context: 'The selected passage turns desire into motion, music, spring, and a great wagon that must move slowly enough for human frailty.',
    style: 'painterly watercolor with gentle mystical warmth and subtle Persian miniature influence',
    avoid: 'avoid exoticized costume, decorative clutter, or literal religious iconography'
  },
  {
    slug: 'after-the-fire',
    lines: [[1, 10]],
    context: 'This is grief as a physical weather system and as a bright, determined flame inside exhaustion.',
    style: 'spare cinematic watercolor, ash and rain tones with one living warmth',
    avoid: 'avoid melodrama, house-fire literalism, or a disaster scene'
  },
  {
    slug: 'against-still-life',
    lines: [[46, 57], [73, 82]],
    context: 'The poem asks a still object and a silent lover to reveal the interior worlds hidden beneath ordinary surfaces.',
    style: 'surreal still life with refined painterly restraint',
    avoid: 'avoid gore, cracked human heads, and over-explaining every symbol'
  },
  {
    slug: 'as-bad-as-a-mile',
    lines: [[1, 7]],
    context: 'The tiny miss of an apple core becomes an anatomy of failure moving backward through intention.',
    style: 'minimal observational realism, dry humor, quiet mid-century light',
    avoid: 'avoid slapstick and dramatic mess'
  },
  {
    slug: 'do-not-go-gentle-into-that-good-night',
    lines: [[21, 24]],
    context: 'The passage is intimate and defiant: a father on the sad height, fierceness and blessing at the edge of night.',
    style: 'mythic landscape painting with restrained twilight drama',
    avoid: 'avoid deathbed imagery, angels, or literal flames on a body'
  },
  {
    slug: 'fire-and-ice',
    lines: [[1, 9]],
    context: 'The poem compresses desire and hate into two elemental ways a world can end.',
    style: 'stark symbolic gouache with elegant simplicity',
    avoid: 'avoid disaster-movie destruction or cheesy apocalypse imagery'
  },
  {
    slug: 'good-bones',
    lines: [[13, 17]],
    context: 'A parent tries to sell a damaged world to children by seeing the possibility inside its structure.',
    style: 'contemporary editorial illustration, humane and unsentimental',
    avoid: 'avoid harmed children, gore, or a real estate advertisement look'
  },
  {
    slug: 'grandfathers-hands',
    lines: [[1, 10]],
    context: 'Hands become geography, intimacy, family memory, and a private origin map.',
    style: 'intimate watercolor and colored pencil, warm chiaroscuro',
    avoid: 'avoid explicit nudity, stereotypes, and literal map labels'
  },
  {
    slug: 'having-a-coke-with-you',
    lines: [[3, 8], [21, 26]],
    context: 'The beloved standing in ordinary light matters more than famous travel, museums, and finished art.',
    style: 'warm city realism with a 1960s color-film feeling',
    avoid: 'avoid soda branding, copied artworks, readable labels, and museum-postcard stiffness'
  },
  {
    slug: 'having-having-a-coke-with-you-with-you',
    lines: [[1, 4], [23, 29]],
    context: 'A walk and a recitation turn into astonishment, attention, and the quiet certainty of wanting a life with someone.',
    style: 'contemporary narrative watercolor, soft city light',
    avoid: 'avoid speech bubbles, visible poem text, and brand marks'
  },
  {
    slug: 'high-windows',
    lines: [[21, 24]],
    context: 'The poem ends by leaving social provocation behind for a blank, impersonal, endless blue beyond glass.',
    style: 'sparse mid-century surreal realism, cool light and negative space',
    avoid: 'avoid explicit sexuality and literal people'
  },
  {
    slug: 'home',
    lines: [[1, 4], [97, 102]],
    context: 'The passage is about forced departure: home itself becoming the danger that drives a person toward any possible safety.',
    style: 'restrained humanitarian symbolism with documentary gravity',
    avoid: 'avoid gore, slurs, sexual violence, and exploitative refugee imagery'
  },
  {
    slug: 'humpbacks',
    lines: [[28, 48]],
    context: 'The image should feel the shock of immense animal joy breaking upward through water and briefly changing the scale of life.',
    style: 'naturalist marine watercolor with ecstatic scale',
    avoid: 'avoid theme-park spectacle or inaccurate whale anatomy'
  },
  {
    slug: 'i-carry-your-heart-within-me',
    lines: [[1, 4], [11, 17]],
    context: 'Love is carried inside the self and also becomes root, bud, sky, stars, and the hidden architecture of a shared life.',
    style: 'tender symbolic watercolor and ink',
    avoid: 'avoid heart icons, anatomical hearts, and greeting-card sentimentality'
  },
  {
    slug: 'i-like-my-body-when-it-is-with-your',
    lines: [[3, 3]],
    context: 'Use this as an abstract image of embodied aliveness: closeness making perception feel newly tuned, energetic, and awake.',
    style: 'non-figurative modernist abstraction with tactile warmth and subtle electric energy',
    avoid: 'avoid bodies, nudity, sex, identifiable faces, and voyeurism'
  },
  {
    slug: 'if',
    lines: [[1, 8], [32, 35]],
    context: 'The poem imagines steadiness under pressure and a life measured by discipline, patience, and composure.',
    style: 'stoic allegorical realism with warm workshop light',
    avoid: 'avoid colonial nostalgia, military heroics, and triumphalist poster art'
  },
  {
    slug: 'in-blackwater-woods',
    lines: [[1, 9], [38, 44]],
    context: 'Attention to autumn beauty becomes instruction in loving what is mortal and letting it go.',
    style: 'luminous naturalist watercolor, reflective and quiet',
    avoid: 'avoid sentimental symbols or visible words'
  },
  {
    slug: 'in-the-trance',
    lines: [[1, 17]],
    context: 'The poem makes love feel like a made thing, a trance, a small craft held between bee, albatross, glacier, and time.',
    style: 'airy surreal maritime watercolor',
    avoid: 'avoid political caricature or overly literal illustration'
  },
  {
    slug: 'jabberwocky',
    lines: [[1, 9], [15, 19]],
    context: 'This is a nonsense quest: playful danger, invented creatures, and a charged pause before action.',
    style: 'storybook engraving with hand-tinted watercolor',
    avoid: 'avoid gore, severed heads, and childish cartooning'
  },
  {
    slug: 'kindness',
    lines: [[1, 13], [23, 36]],
    context: 'Kindness is understood only after loss and sorrow; it becomes practical, bodily, and companionable.',
    style: 'spare humanist watercolor and graphite',
    avoid: 'avoid literal roadside death, stereotypes, and sentimentality'
  },
  {
    slug: 'kubla-kahn',
    lines: [[1, 12]],
    context: 'The selected lines are a visionary landscape of dome, sacred river, caverns, gardens, and impossible scale.',
    style: 'Romantic sublime watercolor, dreamlike but not crowded',
    avoid: 'avoid orientalist stereotypes and generic fantasy-palace imagery'
  },
  {
    slug: 'leda-and-the-swan',
    lines: [[1, 1], [10, 17]],
    context: 'The poem links mythic violence to historical catastrophe; the image should face the terror without eroticizing it.',
    style: 'classical-symbolist chiaroscuro, severe and morally uneasy',
    avoid: 'avoid nudity, explicit assault, erotic posing, and gore'
  },
  {
    slug: 'lets-not-begin',
    lines: [[7, 13], [46, 53]],
    context: 'The speaker tries to choose bees, honey, and a sleeping child as a disciplined beginning against fear.',
    style: 'tender editorial gouache, honeyed morning restraint',
    avoid: 'avoid threatening insects or bleak child imagery'
  },
  {
    slug: 'london',
    lines: [[1, 9], [16, 19]],
    context: 'A city walk becomes a vision of social suffering and invisible bondage.',
    style: 'engraving-influenced watercolor, soot, fog, and moral pressure',
    avoid: 'avoid graphic poverty, explicit sex work, and readable signs'
  },
  {
    slug: 'nothing-gold-can-stay',
    lines: [[1, 8]],
    context: 'The image should hold the fragile instant when first beauty is already passing away.',
    style: 'restrained macro watercolor realism',
    avoid: 'avoid added symbols or inspirational-poster mood'
  },
  {
    slug: 'on-this-the-100th-anniversary-of-the-sinking-of-the-titanic',
    lines: [[59, 67]],
    context: 'Titanic becomes a wise, wounded interlocutor teaching that the heart can sink and return, full of rooms for love.',
    style: 'cinematic underwater surrealism with intimacy and warmth',
    avoid: 'avoid skeletons, gore, disaster spectacle, and film still references'
  },
  {
    slug: 'ozymandias',
    lines: [[1, 8], [12, 14]],
    context: 'Imperial power survives only as broken stone and an empty desert around it.',
    style: 'monumental archaeological watercolor realism',
    avoid: 'avoid readable inscriptions and fantasy ruin excess'
  },
  {
    slug: 'pyramid-scheme',
    lines: [[60, 77]],
    context: 'The poem turns love into a comic economy of sarcophagi, cold pizza, sun money, fire, and impossible happiness.',
    style: 'playful surreal editorial gouache',
    avoid: 'avoid MLM infographics, brand logos, and making the joke too literal'
  },
  {
    slug: 'sailing-to-byzantium',
    lines: [[29, 39]],
    context: 'The speaker wants to leave mortal nature and enter a crafted, golden, singing form of eternity.',
    style: 'Byzantine mosaic influence with symbolist watercolor',
    avoid: 'avoid generic fantasy cities or readable religious text'
  },
  {
    slug: 'sonnet-116',
    lines: [[1, 8]],
    context: 'Love is imagined as a fixed mark and guiding star, steady through alteration and storm.',
    style: 'romantic maritime chiaroscuro, elegant and unsentimental',
    avoid: 'avoid wedding imagery and heart symbols'
  },
  {
    slug: 'sonnet-73',
    lines: [[1, 8]],
    context: 'Aging love is seen through autumn branches, ruined choirs, twilight, and the approach of night.',
    style: 'muted late-autumn oil and watercolor',
    avoid: 'avoid horror imagery and skulls'
  },
  {
    slug: 'stolen-moments',
    lines: [[1, 14]],
    context: 'A single erotic memory condenses into orange, kitchen light, purple flowers, and neural afterglow.',
    style: 'sensual cinematic still life, adult but indirect',
    avoid: 'avoid explicit bodies, nudity, or voyeurism'
  },
  {
    slug: 'stopping-by-woods-on-a-snowy-evening',
    lines: [[6, 14], [16, 19]],
    context: 'The image should hold the hush and temptation of stopping between dark woods, frozen lake, snow, and obligations.',
    style: 'quiet winter nocturne watercolor',
    avoid: 'avoid cozy holiday-card warmth'
  },
  {
    slug: 'telemachus',
    lines: [[1, 11], [27, 35]],
    context: 'The son, father, shore, erased tracks, and cathedral of trees make a grief image of inheritance and war.',
    style: 'lyrical watercolor realism with restrained surreal memory',
    avoid: 'avoid visible wounds, gore, and sensational violence'
  },
  {
    slug: 'tell-all-the-truth-but-tell-it-slant',
    lines: [[1, 8]],
    context: 'Truth is too bright directly; it must be angled, softened, and allowed to dazzle gradually.',
    style: 'minimal luminous watercolor and ink',
    avoid: 'avoid literal typography, slogans, and harsh lightning cliches'
  },
  {
    slug: 'the-blue-house',
    lines: [[1, 5], [11, 13]],
    context: 'The house is seen from a strange afterlife angle, full of joy, sorrow, wilderness, alternatives, and a sister vessel.',
    style: 'Nordic magical realism in watercolor and gouache',
    avoid: 'avoid haunted-house cliches and over-clutter'
  },
  {
    slug: 'the-broken-buddha',
    lines: [[17, 22], [41, 53]],
    context: 'A repaired Buddha becomes a teacher because brokenness is not the opposite of dignity.',
    style: 'quiet devotional still life, respectful and simple',
    avoid: 'avoid exotic spectacle, mockery, and decorative excess'
  },
  {
    slug: 'the-eagle',
    lines: [[1, 7]],
    context: 'The poem compresses height, solitude, predatory stillness, and sudden descent.',
    style: 'crisp naturalist watercolor and gouache',
    avoid: 'avoid superhero lightning or cartoon bird drama'
  },
  {
    slug: 'the-journey',
    lines: [[1, 12], [31, 36]],
    context: 'The poem is about leaving bad advice and saving the only life one can save.',
    style: 'cinematic symbolic watercolor, restrained but moving',
    avoid: 'avoid screaming faces and visible written words'
  },
  {
    slug: 'the-kingfisher',
    lines: [[1, 7], [19, 24]],
    context: 'The kingfisher is beauty and predation at once: a perfect flash of blue, silver, black water, and happiness.',
    style: 'vivid naturalist watercolor freeze-frame',
    avoid: 'avoid blood and cartoon prettiness'
  },
  {
    slug: 'the-light-wraps-you',
    lines: [[1, 16], [18, 22]],
    context: 'Light, mourning, fire, night roots, creation, fertility, and sadness move around one solitary figure.',
    style: 'surreal portrait in watercolor and oil pastel',
    avoid: 'avoid bondage imagery and oversexualization'
  },
  {
    slug: 'the-moment',
    lines: [[1, 13], [15, 20]],
    context: 'The instant of claiming ownership becomes the instant the living world withdraws and corrects the claim.',
    style: 'ecological surreal editorial watercolor',
    avoid: 'avoid triumphant ownership, flags, or slogans'
  },
  {
    slug: 'the-red-wheelbarrow',
    lines: [[1, 11]],
    context: 'The poem asks for radical attention to a few ordinary things after rain.',
    style: 'minimal rural watercolor still life',
    avoid: 'avoid extra symbolism or decorative complexity'
  },
  {
    slug: 'the-road-not-taken',
    lines: [[1, 5], [7, 12]],
    context: 'The two roads should feel genuinely close in possibility; the image should preserve ambiguity rather than celebrate a heroic choice.',
    style: 'soft naturalist watercolor landscape',
    avoid: 'avoid signs, arrows, and spotlighting one path as correct'
  },
  {
    slug: 'the-second-coming',
    lines: [[1, 8], [15, 23]],
    context: 'The gyre, falcon, desert vision, and rough beast should feel like a civilization losing center.',
    style: 'apocalyptic surrealism with sand-textured painterly restraint',
    avoid: 'avoid gore, explicit religious horror, and monster-movie treatment'
  },
  {
    slug: 'the-summer-day',
    lines: [[3, 14], [16, 19]],
    context: 'Attention to a grasshopper becomes a kind of prayer and a question about how to spend a life.',
    style: 'luminous naturalist macro watercolor',
    avoid: 'avoid sentimentality and insect-horror scale'
  },
  {
    slug: 'the-tyger',
    lines: [[1, 9], [26, 29]],
    context: 'The tiger is a creature of fire, symmetry, fear, making, and sacred mystery.',
    style: 'hand-tinted engraving with firelit gouache',
    avoid: 'avoid cartoon tiger and decorative typography'
  },
  {
    slug: 'the-waking',
    lines: [[1, 10], [21, 24]],
    context: 'The poem moves by paradox: waking into sleep, learning by going, and being steadied by shaking.',
    style: 'quiet dream realism in watercolor and graphite',
    avoid: 'avoid literal sleeping-person imagery'
  },
  {
    slug: 'to-my-favorite-17-year-old-high-school-girl',
    lines: [[1, 6], [33, 36]],
    context: 'The poem affectionately rejects achievement comparisons in favor of ordinary teenage being.',
    style: 'warm domestic editorial illustration, gently funny',
    avoid: 'avoid sexualizing the minor, celebrity likenesses, and readable posters'
  },
  {
    slug: 'toad',
    lines: [[1, 11]],
    context: 'The speaker talks philosophy to a motionless toad in heat and dust; the toad remains the calm center.',
    style: 'ground-level naturalist watercolor, meditative and dryly humorous',
    avoid: 'avoid caricature and religious props'
  },
  {
    slug: 'variation-on-the-word-sleep',
    lines: [[9, 28]],
    context: 'The speaker wants to enter another person\'s dream and accompany them through fear with protective objects and a small returning flame.',
    style: 'nocturne watercolor and ink, protective and dreamlike',
    avoid: 'avoid voyeuristic sleeping-body imagery and horror'
  },
  {
    slug: 'what-i-didnt-know-before',
    lines: [[1, 14]],
    context: 'A love is compared to a foal arriving already itself, ungentle, embodied, and ready to run.',
    style: 'clean contemporary realism with watercolor softness',
    avoid: 'avoid graphic birth imagery'
  },
  {
    slug: 'white-owl-flies-into-and-out-of-the-field',
    lines: [[1, 21], [22, 38]],
    context: 'The owl strike and rise transform death from darkness into overwhelming light.',
    style: 'high-key winter watercolor realism, pale and spiritual without sentimentality',
    avoid: 'avoid blood, prey, and macabre death imagery'
  },
  {
    slug: 'wild-geese',
    lines: [[1, 18]],
    context: 'The poem moves from permission and bodily tenderness into a wide landscape that calls the lonely person back into belonging.',
    style: 'expansive pastoral watercolor, clear air and restraint',
    avoid: 'avoid motivational-poster sentimentality'
  }
];

const PASS_TWO_REVISIONS = {
  'against-still-life': {
    lines: [[73, 82]],
    context: 'Focus on the end image: the silhouette contains mountains, garden and chaos, ocean and hurricane, private rooms, deserts, dinosaurs, and the first woman.',
    style: 'refined surreal silhouette, interior imagery blown open and luminous',
    avoid: 'avoid oranges, gore, cracked heads, and over-explaining every symbol'
  },
  'as-bad-as-a-mile': {
    context: 'The small miss should feel witty and existential: an ordinary failure suddenly exposes the whole backward chain of intention, hand, arm, mind, and self.',
    style: 'wry, sharply composed editorial surrealism with mid-century restraint',
    avoid: 'avoid bland kitchen realism, slapstick, and dramatic mess'
  },
  'do-not-go-gentle-into-that-good-night': {
    context: 'Make the father a small distant figure high on the ridge, nearly swallowed by the sad height, with the emotional force carried by scale and atmosphere.',
    style: 'spare mythic landscape, tiny human figure against vast twilight',
    avoid: 'avoid close portraits, deathbeds, angels, and literal flames on a body'
  },
  'good-bones': {
    context: 'Use the end of the poem: someone looking around a genuinely rough, damaged place and seeing only the faintest potential that it could become beautiful.',
    style: 'tough contemporary editorial realism, unsentimental and a little bleak',
    avoid: 'avoid harmed children, gore, clean real-estate staging, and easy optimism'
  },
  'grandfathers-hands': {
    context: 'Make this an intimate close-up of one hand as geography, memory, origin, and family tenderness.',
    style: 'close watercolor and colored pencil study, warm skin tones and quiet shadow',
    avoid: 'avoid faces, full bodies, explicit nudity, stereotypes, and literal map labels'
  },
  'having-a-coke-with-you': {
    lines: [[12, 26]],
    context: 'Use the more abstract movement of the poem: portraiture loses its faces, art history recedes, and the living beloved becomes the marvelous experience.',
    style: 'abstract romantic city painting, warm 1960s color pushed toward painterly abstraction',
    avoid: 'avoid soda branding, copied artworks, readable labels, literal museum rooms, and postcard stiffness'
  },
  'high-windows': {
    context: 'The viewpoint should be so far below the high window that only perfect blue sky is visible through it, while the bleak ground world is excluded.',
    style: 'sparse mid-century surreal realism, severe vertical framing and cool negative space',
    avoid: 'avoid explicit sexuality, visible people, and showing the ground outside the window'
  },
  'i-like-my-body-when-it-is-with-your': {
    lines: [[1, 8]],
    context: 'Make this lightly sexual but abstract: embodied closeness, a beautiful female form suggested through curves, breath, and charged touch rather than literal nudity.',
    style: 'sensual modernist abstraction with graceful body imagery and tactile warmth',
    avoid: 'avoid explicit sex, exposed genitals, voyeurism, identifiable faces, and pornographic posing'
  },
  'if': {
    lines: [[10, 17], [23, 26]],
    context: 'Try a less obvious approach: inner steadiness under pressure, dreams and thoughts not ruling the self, broken work rebuilt, and the will holding on after exhaustion.',
    style: 'symbolic psychological realism with restrained graphic power',
    avoid: 'avoid colonial nostalgia, military heroics, sports-poster triumph, and literal father-son staging'
  },
  'in-blackwater-woods': {
    context: 'The trees and the black river of loss should both be present: autumn beauty reflected in dark water, with letting go carried by the landscape.',
    style: 'luminous naturalist watercolor with a dark reflective river',
    avoid: 'avoid sentimental symbols, visible words, and making the river merely decorative'
  },
  'in-the-trance': {
    lines: [[1, 8]],
    context: 'Choose one singular image from the trance: the speaker making a small wooden boat and entering a simplified dream of love and craft.',
    style: 'minimal airy surrealism, one clear maritime image with quiet space',
    avoid: 'avoid crowded symbolic collage, political caricature, and literal illustration of every noun'
  },
  'jabberwocky': {
    context: 'Keep the playful danger but make the vorpal sword feel mythic, charged, and central without turning the image into gore.',
    style: 'mythic storybook engraving with hand-tinted color and a luminous blade',
    avoid: 'avoid gore, severed heads, childish cartooning, and generic fantasy armor'
  },
  'kubla-kahn': {
    context: 'Make the visionary landscape fantastical, ominous, and vivid: dome, sacred river, caverns, gardens, and impossible scale should pop with modern color.',
    style: 'hyper-modern fantastical sublime, vivid ominous color, cinematic depth',
    avoid: 'avoid muted watercolor, orientalist stereotypes, and generic palace fantasy'
  },
  'leda-and-the-swan': {
    lines: [[11, 17]],
    context: 'Try a different approach: focus on the catastrophe the myth unleashes, with wing, broken wall, burning roof and tower, and indifferent power implied rather than enacted.',
    style: 'severe symbolist abstraction, classical fragments and white wing shadow',
    avoid: 'avoid nudity, explicit assault, erotic posing, gore, and depicting the act itself'
  },
  'london': {
    context: 'Keep the engraving mood but simplify: a bleak city walk, invisible manacles, soot, fog, and moral pressure without a sky crowded by sad faces.',
    style: 'spare Blakean engraving with noir watercolor wash',
    avoid: 'avoid many faces in the sky, graphic poverty, explicit sex work, and readable signs'
  },
  'nothing-gold-can-stay': {
    context: 'The style is close; make the fragile first gold more clearly golden while keeping the image restrained and transient.',
    style: 'restrained macro watercolor realism, clearer gold-green first light',
    avoid: 'avoid added symbols, inspirational-poster mood, and over-saturation'
  },
  'on-this-the-100th-anniversary-of-the-sinking-of-the-titanic': {
    context: 'Do not personify the Titanic. Show the vivid interior life of the ship underwater, with rooms of warmth and memory visible inside the sunken structure.',
    style: 'cinematic underwater surrealism, intimate glowing interiors inside the wreck',
    avoid: 'avoid faces on the ship, skeletons, gore, disaster spectacle, and film still references'
  },
  'pyramid-scheme': {
    context: 'Keep the style but simplify: focus on the couple, the sun, raining coins, and maybe cold pizza on the stairs; let the joke stay romantic and absurd.',
    style: 'playful surreal editorial gouache, bright and focused',
    avoid: 'avoid eyes, dogs, extra side images, MLM infographics, and brand logos'
  },
  'sailing-to-byzantium': {
    lines: [[1, 8], [29, 39]],
    context: 'Keep the Grecian gold bird, but bring in the sailing passage: mortal nature recedes behind the voyage toward Byzantium and crafted eternity.',
    style: 'Byzantine gold mosaic influence with lyrical sea voyage imagery',
    avoid: 'avoid generic fantasy cities, readable religious text, and losing the sense of travel by water'
  },
  'sonnet-116': {
    context: 'Try a more love-forward approach: love as a steadfast presence between two people that still carries the fixed mark, guiding star, and storm imagery.',
    style: 'tender romantic symbolism, elegant maritime light, unsentimental warmth',
    avoid: 'avoid wedding cliches, heart icons, and cold empty lighthouse imagery'
  },
  'stopping-by-woods-on-a-snowy-evening': {
    context: 'Keep the quiet winter nocturne, but place woods on both sides of the sleigh instead of opening the scene to a lake.',
    style: 'quiet winter nocturne watercolor, close dark woods and falling snow',
    avoid: 'avoid lakes, cozy holiday-card warmth, and bright village scenes'
  },
  'the-kingfisher': {
    lines: [[21, 24]],
    context: 'Use the final image: the kingfisher flying perfectly back over the bright sea, carrying the force of hunger, beauty, and a cry the speaker cannot make.',
    style: 'vivid naturalist watercolor, clean bright sea and perfect movement',
    avoid: 'avoid blood, dark wave focus, and cartoon prettiness'
  },
  'the-light-wraps-you': {
    lines: [[18, 22]],
    context: 'Treat this as an ode to the moon: a magnetic black-and-gold circle, fertility, sadness, and creation revolving around a solitary presence.',
    style: 'lunar surrealism in black, gold, and pale blue; elegant and magnetic',
    avoid: 'avoid bondage imagery, oversexualization, and sun-dominated compositions'
  },
  'the-road-not-taken': {
    context: 'Keep the ambiguity of two close paths, but make the visual style more distinctive and less conventional.',
    style: 'stylized printmaking and watercolor, layered autumn texture and unusual perspective',
    avoid: 'avoid signs, arrows, and spotlighting one path as correct'
  },
  'the-second-coming': {
    lines: [[1, 8]],
    context: 'Use the opening image: widening gyre, falcon losing the falconer, the center failing, and things falling apart.',
    style: 'apocalyptic abstract landscape, spiraling motion and stark falcon silhouette',
    avoid: 'avoid desert beast imagery, gore, explicit religious horror, and monster-movie treatment'
  },
  'to-my-favorite-17-year-old-high-school-girl': {
    context: 'Try a more playful approach: ordinary teenage mess and comic historical comparison should feel affectionate, not moralizing.',
    style: 'playful editorial illustration, bright domestic wit and loose composition',
    avoid: 'avoid sexualizing the minor, celebrity likenesses, readable posters, and scolding tone'
  },
  'variation-on-the-word-sleep': {
    lines: [[9, 17]],
    context: 'Focus on two people walking through the lucent bluegreen forest toward the cave; one carries a silver branch with a small white flower.',
    style: 'nocturne watercolor and ink, lucent bluegreen forest, protective and dreamlike',
    avoid: 'avoid disembodied hands, voyeuristic sleeping-body imagery, and horror'
  },
  'what-i-didnt-know-before': {
    context: 'Focus on the foal arriving newly born yet already full of running speed: ungentle, alive, and ready to leap into itself.',
    style: 'clean contemporary realism with watercolor softness and kinetic newborn energy',
    avoid: 'avoid graphic birth imagery, sentimentality, and making the horse look fully grown'
  },
  'white-owl-flies-into-and-out-of-the-field': {
    context: 'Make the central image a river of pure, blindingly white owl feathers moving through the rest of the winter scene.',
    style: 'high-key winter watercolor, almost overwhelming white feather-light',
    avoid: 'avoid blood, prey, macabre death imagery, and a conventional owl portrait'
  }
};

const PASS_THREE_REVISIONS = {
  'a-finger-two-dots-then-me': {
    context: 'Keep the celestial hand idea, but move the human presence offscreen: a human hand reaches from the bottom-left edge toward a vast celestial hand in the sky, without showing the person.',
    style: 'luminous cosmic surrealism, intimate scale contrast and warm starlight',
    avoid: 'avoid a central human figure, faces, cartoon space art, literal gods, and visual text'
  },
  'against-still-life': {
    lines: [[73, 82]],
    context: 'Preserve the luminous blown-open interior imagery, but make the silhouette clearly male: mountains, garden and chaos, ocean, hurricane, private rooms, deserts, dinosaurs, and the first woman held inside him.',
    style: 'refined surreal male silhouette, interior imagery blown open and luminous',
    avoid: 'avoid a female silhouette, oranges, gore, cracked heads, and over-explaining every symbol'
  },
  'as-bad-as-a-mile': {
    context: 'The image should finally carry the feeling of being a failure: the tiny missed apple core becomes a humiliating inner collapse spreading backward into the calm unraised hand.',
    style: 'psychological editorial surrealism, stark and dry, with Larkin-like bitterness',
    avoid: 'avoid bland still life, slapstick, cute humor, and ordinary kitchen realism'
  },
  'do-not-go-gentle-into-that-good-night': {
    context: 'Move closer to night: a small distant father on the sad height almost disappears into darkness, with only a last pressure of light and fierce feeling remaining.',
    style: 'dark nocturne landscape, spare and almost black, with one dying edge of light',
    avoid: 'avoid daytime skies, close portraits, deathbeds, angels, and literal flames on a body'
  },
  'grandfathers-hands': {
    context: 'The close-up should let the map cover the hand, skin, wrist, and forearm more completely, as if geography and family memory are drawn into the body itself.',
    style: 'intimate watercolor and colored pencil close-up, warm skin and hand-drawn map texture',
    avoid: 'avoid faces, full bodies, explicit nudity, stereotypes, and literal readable map labels'
  },
  'high-windows': {
    context: 'Make this a child looking up from below at a normal high window in an ordinary room, seeing only perfect blue sky beyond it and none of the bleak ground world.',
    style: 'plain domestic realism with a metaphysical blank blue beyond the window',
    avoid: 'avoid monumental architecture, surreal towers, explicit sexuality, visible people outside, and showing the ground'
  },
  'i-like-my-body-when-it-is-with-your': {
    lines: [[3, 3]],
    context: 'Blend the two earlier directions through non-representational abstraction: muscles and nerves feel newly awake as tactile curves, charged lines, warmth, and motion, without depicting a person.',
    style: 'modernist abstract composition, graceful kinetic curves and tactile warmth',
    avoid: 'avoid visible bodies, nudity, sexual content, faces, voyeurism, and pornographic posing'
  },
  'if': {
    lines: [[19, 26], [32, 35]],
    context: 'Try a fresh image around endurance after loss: everything risked and lost, the body emptied out, and the will still saying hold on into the unforgiving minute.',
    style: 'severe symbolic realism, quiet pressure rather than triumph',
    avoid: 'avoid colonial nostalgia, military heroics, sports-poster triumph, and literal father-son staging'
  },
  'in-the-trance': {
    lines: [[1, 17]],
    context: 'Return the glacier to the image: one small craft or boat held in a trance-like water world, with the glacier making time feel suspended and strange.',
    style: 'minimal airy surrealism, glacier light, small boat, and quiet negative space',
    avoid: 'avoid crowded collage, political caricature, and illustrating every noun'
  },
  'jabberwocky': {
    context: 'Bring back the Alice-in-Wonderland creature-world feeling: strange creatures in the wabe and tulgey wood should surround the quest, not just the Jabberwock.',
    style: 'mythic storybook engraving with hand-tinted color, curious creatures and a charged blade',
    avoid: 'avoid gore, severed heads, childish cartooning, and making only a monster portrait'
  },
  'london': {
    context: 'Keep the bleak-but-not-overdone city mood, but remove visible chains entirely; let fog, soot, posture, architecture, and pressure carry the manacles.',
    style: 'spare Blakean engraving with noir watercolor wash',
    avoid: 'avoid visible chains, many faces in the sky, graphic poverty, explicit sex work, and readable signs'
  },
  'on-this-the-100th-anniversary-of-the-sinking-of-the-titanic': {
    context: 'Show a woman at the bottom of the ocean looking up at the sunken ship, while the Titanic itself remains a vivid interior world rather than a personified figure.',
    style: 'cinematic underwater surrealism, glowing interiors above a solitary woman below',
    avoid: 'avoid faces on the ship, skeletons, gore, disaster spectacle, and film still references'
  },
  'pyramid-scheme': {
    context: 'Bring back the playful first-attempt vibe: a couple walking down the sidewalk together, with sun, raining coins, and maybe cold pizza on stairs as the focused comic-romantic world.',
    style: 'playful surreal editorial gouache, sweet, bright, and lightly absurd',
    avoid: 'avoid eyes, dogs, extra side images, MLM infographics, and brand logos'
  },
  'sailing-to-byzantium': {
    lines: [[1, 8], [29, 39]],
    context: 'The ship is sailing toward Byzantium; the golden bird belongs in Byzantium, waiting on a golden bough or in the city, not perched on the ship.',
    style: 'Byzantine gold mosaic influence with lyrical sea voyage imagery',
    avoid: 'avoid putting the gold bird on the ship, generic fantasy cities, and readable religious text'
  },
  'telemachus': {
    lines: [[27, 35]],
    context: 'Focus on the image of looking down at the father: sea-black eyes holding a cathedral, with perhaps a faint reflection of the sun looking down.',
    style: 'lyrical close realism with restrained surreal reflection',
    avoid: 'avoid visible wounds, gore, sensational violence, and wide action scenes'
  },
  'the-kingfisher': {
    lines: [[21, 24]],
    context: 'Use the final flight over the bright sea but return to the more photorealistic naturalist feeling of the first image.',
    style: 'photorealistic naturalist marine image, vivid blue kingfisher over bright sea',
    avoid: 'avoid cartoon prettiness, painterly looseness that loses realism, blood, and dark wave focus'
  },
  'the-road-not-taken': {
    context: 'Move back toward realism while preserving ambiguity: two close autumn paths in a real yellow wood, neither presented as the heroic or correct choice.',
    style: 'realistic atmospheric autumn landscape with subtle painterly texture',
    avoid: 'avoid stylized print abstraction, signs, arrows, and spotlighting one path as correct'
  },
  'the-second-coming': {
    lines: [[1, 8]],
    context: 'Stay with the widening gyre and falcon losing the falconer, but make the image aesthetically stranger and more compelling while preserving the near-successful composition.',
    style: 'apocalyptic abstract landscape, spiraling motion, stark falcon silhouette, visually arresting composition',
    avoid: 'avoid desert beast imagery, gore, explicit religious horror, and monster-movie treatment',
    n: 2
  },
  'to-my-favorite-17-year-old-high-school-girl': {
    context: 'Remove thought-bubble or fantasy-comparison devices. Make this a mundane affectionate scene of the girl and her dad hanging out while she plays with her food.',
    style: 'warm playful domestic editorial realism, ordinary and gently funny',
    avoid: 'avoid thought bubbles, fantasy cutaways, sexualizing the minor, celebrity likenesses, readable posters, and scolding tone'
  },
  'variation-on-the-word-sleep': {
    lines: [[9, 17]],
    context: 'Keep the composition close, but make it more watercolor-like and slightly more abstract: two figures in the lucent bluegreen forest approaching the cave, one carrying the silver branch and small white flower.',
    style: 'loose nocturne watercolor, translucent bluegreen washes, softly abstract and protective',
    avoid: 'avoid hard-edged digital fantasy, disembodied hands, voyeuristic sleeping-body imagery, and horror'
  }
};

const PASS_FOUR_REVISIONS = {
  'a-finger-two-dots-then-me': {
    context: 'Keep searching within the celestial-hand idea: a human hand only enters from the extreme lower-left edge, reaching toward a vast celestial hand or presence in the sky, with the rest of the person completely outside the frame.',
    style: 'luminous cosmic surrealism, intimate scale contrast, warm starlight, and quiet negative space',
    avoid: 'avoid a central human figure, faces, bodies, cartoon space art, literal gods, and visual text'
  },
  'as-bad-as-a-mile': {
    context: 'Try a few more varied tactics for the feeling of failure. The missed apple core is tiny, but the image should make the viewer feel the whole inward collapse of having failed before anything has visibly happened.',
    style: 'psychological editorial image-making, dry and spare, with room for surreal or abstract solutions',
    avoid: 'avoid bland still life, slapstick, cute humor, ordinary kitchen realism, and motivational symbolism',
    n: 3
  },
  'grandfathers-hands': {
    context: 'Make the hand unmistakably old: weathered skin, age spots, veins, and softened strength. The map should cover the hand, wrist, and forearm as family geography drawn into elderly skin.',
    style: 'intimate watercolor and colored pencil close-up, tactile elderly skin, hand-drawn map texture',
    avoid: 'avoid young or smooth hands, faces, full bodies, explicit nudity, stereotypes, and readable map labels'
  },
  'high-windows': {
    context: 'Keep the ordinary high window but remove the person entirely. The viewer is low in a plain room looking up at a normal high window that holds only perfect blue sky, with no human figure inside or outside.',
    style: 'plain domestic realism with metaphysical blue emptiness beyond the glass',
    avoid: 'avoid people, silhouettes, monumental architecture, surreal towers, explicit sexuality, and showing the ground'
  },
  'if': {
    lines: [[19, 26], [32, 35]],
    context: 'Move away from literal scenes and make an abstract image of the poem noble and triumphant without becoming a poster: steadiness, discipline, loss, endurance, and the inner command to hold on.',
    style: 'abstract symbolic composition with restrained nobility, pressure, balance, and a quiet gold warmth',
    avoid: 'avoid literal men, workshops, father-son staging, colonial nostalgia, military heroics, sports-poster triumph, and readable text'
  },
  'in-the-trance': {
    lines: [[1, 17]],
    context: 'Keep the glacier and the small craft in a suspended trance-like water world, but remove the bird entirely. Let glacier, boat, water, and stillness carry the strangeness of love being made.',
    style: 'minimal airy surrealism, glacier light, small boat, and quiet negative space',
    avoid: 'avoid birds, albatrosses, crowded collage, political caricature, and illustrating every noun'
  },
  'pyramid-scheme': {
    context: 'Keep the couple walking down the sidewalk together, the playful coins, and the sweet absurd romance. Remove the burning buildings in the sky; make the sun feel like the flat radiant playful sun from the first attempt.',
    style: 'playful surreal editorial gouache, sweet, bright, lightly absurd, with a simple radiant coin-like sun',
    avoid: 'avoid burning buildings, smoke, apocalyptic skies, eyes, dogs, extra side images, MLM infographics, and brand logos'
  },
  'telemachus': {
    lines: [[27, 35]],
    context: 'Make the father lie on sand while the boy looks down at him. The father should feel near death, with sea-black eyes that hold the cathedral reflection; the sun may faintly look down too.',
    style: 'lyrical close realism with restrained surreal reflection, sand, black sea-eyes, and quiet grief',
    avoid: 'avoid gore, visible wounds, sensational violence, wide action scenes, and making the father look merely asleep'
  },
  'the-kingfisher': {
    lines: [[21, 24]],
    context: 'Show the kingfisher flying away from the camera, from a behind and slightly over-the-shoulder view, skimming perfectly over the bright sea.',
    style: 'photorealistic naturalist marine image, vivid blue kingfisher, bright sea, precise motion',
    avoid: 'avoid front-facing bird portraits, cartoon prettiness, painterly looseness that loses realism, blood, and dark wave focus'
  },
  'to-my-favorite-17-year-old-high-school-girl': {
    context: 'Remove the father and keep the scene mundane: a teenage girl absent-mindedly playing with her food, ordinary and affectionate, with gentle humor and no fantasy-comparison devices.',
    style: 'loose playful domestic editorial illustration, less photorealistic, warm and ordinary',
    avoid: 'avoid the father, thought bubbles, fantasy cutaways, sexualizing the minor, celebrity likenesses, readable posters, and scolding tone'
  }
};

const PASS_FIVE_REVISIONS = {
  'as-bad-as-a-mile': {
    lines: [[1, 7]],
    context: 'Use a first-person point of view looking down at the speaker\'s own hand just before tossing the apple core. The ordinary hand, the apple core, and the small gap ahead should already carry the feeling of failure before the miss happens.',
    style: 'POV psychological realism, spare and dry, with subtle existential pressure in the composition',
    avoid: 'avoid third-person scenes, bland still life, slapstick, cute humor, kitchen realism, and motivational symbolism',
    n: 2
  },
  'if': {
    lines: [[19, 26], [32, 35]],
    context: 'Try diverse nonliteral images for the triumphant and noble force of the poem: endurance after loss, composure under pressure, inward command, risk, patience, and the unforgiving minute fully inhabited.',
    style: 'varied abstract-symbolic compositions with restraint, nobility, pressure, balance, and warm disciplined light',
    avoid: 'avoid literal men, workshops, father-son staging, colonial nostalgia, military heroics, sports-poster triumph, trophies, and readable text',
    n: 4
  },
  'pyramid-scheme': {
    context: 'Keep the good pose of the couple walking through the streets together, but remove the pizza entirely. Recover the magic of the first-pass sun: playful, radiant, strange, coin-like, and romantic without becoming apocalyptic.',
    style: 'playful surreal editorial gouache, sweet street scene, magical flat radiant sun, lightly absurd romance',
    avoid: 'avoid pizza, burning buildings, smoke, apocalyptic skies, eyes, dogs, extra side images, MLM infographics, and brand logos'
  },
  'telemachus': {
    lines: [[27, 35]],
    context: 'Return to the pass-three viewpoint: the boy looks down from above the father\'s head as the father lies on sand. Keep the eyes nearly black like sea water, with bright cathedral light reflected inside them against the dark black of the rest of the eyes.',
    style: 'lyrical close realism, overhead intimate viewpoint, sand, black sea-eyes, luminous cathedral reflection, quiet grief',
    avoid: 'avoid gore, visible wounds, sensational violence, wide action scenes, and making the father look merely asleep'
  }
};

const PASS_SIX_REVISIONS = {
  'as-bad-as-a-mile': {
    lines: [[1, 7]],
    context: 'Use a first-person point of view looking down at the speaker\'s own hand holding the apple core just before the toss. The image should be only the hand, the apple core, and the imminent small failure, with no basket or target shown.',
    style: 'POV psychological realism, spare and dry, with subtle existential pressure in the hand and empty space',
    avoid: 'avoid baskets, bins, targets, third-person scenes, bland still life, slapstick, cute humor, kitchen realism, and motivational symbolism',
    n: 2
  },
  'telemachus': {
    lines: [[27, 35]],
    context: 'Move closer in on the father\'s face as he lies on sand. The boy may be present only as a partial edge, shadow, or small above-frame presence looking down; the father\'s nearly black sea-eyes with luminous cathedral reflections should dominate.',
    style: 'lyrical close realism, intimate face close-up, sand, black sea-eyes, luminous cathedral reflection, quiet grief',
    avoid: 'avoid making the boy\'s face prominent, gore, visible wounds, sensational violence, wide action scenes, and making the father look merely asleep',
    n: 2
  }
};

const REVISIONS_BY_PASS = {
  2: PASS_TWO_REVISIONS,
  3: PASS_THREE_REVISIONS,
  4: PASS_FOUR_REVISIONS,
  5: PASS_FIVE_REVISIONS,
  6: PASS_SIX_REVISIONS
};

function parseArgs(argv) {
  const args = {
    write: false,
    batchJson: '',
    candidateDir: '',
    candidateRoot: DEFAULT_CANDIDATE_ROOT,
    feedbackJson: '',
    onlyDeveloping: false,
    onlyRejected: false,
    pass: 'pass-001',
    summaryJson: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') args.write = true;
    if (arg === '--batch-json') {
      args.batchJson = path.resolve(repoRoot, argv[i + 1]);
      i += 1;
    }
    if (arg === '--candidate-dir') {
      args.candidateDir = path.resolve(repoRoot, argv[i + 1]);
      i += 1;
    }
    if (arg === '--candidate-root') {
      args.candidateRoot = path.resolve(repoRoot, argv[i + 1]);
      i += 1;
    }
    if (arg === '--feedback-json') {
      args.feedbackJson = path.resolve(repoRoot, argv[i + 1]);
      i += 1;
    }
    if (arg === '--only-developing') args.onlyDeveloping = true;
    if (arg === '--only-rejected') args.onlyRejected = true;
    if (arg === '--pass') {
      args.pass = argv[i + 1];
      i += 1;
    }
    if (arg === '--summary-json') {
      args.summaryJson = path.resolve(repoRoot, argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function parsePoem(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('Missing frontmatter');

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    frontmatter[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }

  return {
    title: frontmatter.title || '',
    author: frontmatter.author || '',
    bodyLines: match[2].trim().split(/\r?\n/)
  };
}

function extractLines(bodyLines, ranges) {
  const blocks = ranges.map(([start, end]) => {
    return bodyLines
      .slice(start - 1, end)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim())
      .join('\n');
  });

  return blocks.filter(Boolean).join('\n[other lines omitted]\n');
}

function buildPrompt({ title, author, selectedLines, context, style, avoid, revision }) {
  const lines = [
    `Create one square companion image for the poem "${title}" by ${author}.`,
    '',
    'Use these exact selected lines as the source passage:',
    '"""',
    selectedLines,
    '"""',
    '',
    `Context: ${context}`,
    ''
  ];

  if (revision) {
    lines.push(`Reviewer direction for this pass: ${revision}`, '');
  }

  lines.push(
    'Goal: Give a viewer a beautiful visual entry point into this passage for a quiet literary archive. Do not mechanically illustrate every noun. Use the poem context and your own strong aesthetic judgment to choose the image that best carries the feeling, visual tension, and imaginative world of the selected lines.',
    '',
    `Light style guidance: ${style}.`,
    '',
    `Constraints: no visible text, handwriting, captions, book covers, logos, signatures, watermarks, frames, or UI; ${avoid}.`
  );

  return lines.join('\n');
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const collections = new Map();
  for (const slug of manifest.memorized || []) collections.set(slug, 'memorized');
  for (const slug of manifest.learning || []) collections.set(slug, 'learning');
  return collections;
}

function loadFeedback(feedbackJson) {
  const empty = {
    payload: null,
    bySlug: new Map(),
    byCandidate: new Map(),
    rejectedSlugs: new Set(),
    developingSlugs: new Set()
  };
  if (!feedbackJson) return empty;
  const payload = JSON.parse(fs.readFileSync(feedbackJson, 'utf8'));
  const bySlug = new Map();
  const byCandidate = new Map();
  const rejectedSlugs = new Set();
  const developingSlugs = new Set(payload.developingSlugs || []);

  for (const item of payload.items || []) {
    const candidates = item.candidates || [];
    for (const candidate of candidates) {
      if (candidate.id) byCandidate.set(candidate.id, candidate.feedback || {});
    }
    const kept = candidates
      .filter((candidate) => candidate.feedback?.status === 'keep')
      .map((candidate) => candidate.id);
    const latestPass = candidates.reduce((max, candidate) => {
      return Math.max(max, getCandidatePassNumber(candidate));
    }, 0);
    const latestCandidates = candidates.filter((candidate) => {
      return getCandidatePassNumber(candidate) === latestPass;
    });
    const rejected = latestCandidates
      .filter((candidate) => candidate.feedback?.status === 'reject')
      .map((candidate) => candidate.feedback?.note || '')
      .filter(Boolean);
    const entry = {
      slug: item.slug,
      promptFeedback: item.feedback || '',
      rejectedNotes: rejected,
      keptCandidates: kept,
      latestPass
    };
    bySlug.set(item.slug, entry);
    if (kept.length === 0 && latestCandidates.some((candidate) => candidate.feedback?.status === 'reject')) {
      rejectedSlugs.add(item.slug);
    }
    if (kept.length === 0) developingSlugs.add(item.slug);
  }

  return { payload, bySlug, byCandidate, rejectedSlugs, developingSlugs };
}

function getCandidatePassNumber(candidate) {
  return parsePassNumber(candidate.pass || String(candidate.id || '').split('::')[1]);
}

function applyRevision(spec, pass, feedback) {
  if (pass === 'pass-001') return spec;
  const revision = REVISIONS_BY_PASS[parsePassNumber(pass)]?.[spec.slug];
  if (!revision && !feedback?.rejectedNotes?.length && !feedback?.promptFeedback) return spec;
  return {
    ...spec,
    ...(revision || {}),
    revision: [
      revision?.revision,
      feedback?.promptFeedback,
      ...(feedback?.rejectedNotes || [])
    ].filter(Boolean).join(' ')
  };
}

function loadPromptItems(args, feedback) {
  const collections = loadManifest();
  const candidateDirs = findCandidateDirs(args);
  return SPECS.map((spec, index) => {
    const effectiveSpec = applyRevision(spec, args.pass, feedback.bySlug.get(spec.slug));
    const markdown = fs.readFileSync(path.join(poemsDir, `${spec.slug}.md`), 'utf8');
    const poem = parsePoem(markdown);
    const selectedLines = extractLines(poem.bodyLines, effectiveSpec.lines);
    const prompt = buildPrompt({
      title: poem.title,
      author: poem.author,
      selectedLines,
      context: effectiveSpec.context,
      style: effectiveSpec.style,
      avoid: effectiveSpec.avoid,
      revision: effectiveSpec.revision
    });
    return {
      order: index + 1,
      slug: spec.slug,
      title: poem.title,
      author: poem.author,
      collection: collections.get(spec.slug) || 'unmatched',
      selectedLines,
      context: effectiveSpec.context,
      style: effectiveSpec.style,
      avoid: effectiveSpec.avoid,
      revision: effectiveSpec.revision || '',
      n: effectiveSpec.n || 1,
      prompt,
      candidates: findCandidates(candidateDirs, spec.slug)
    };
  });
}

function findCandidateDirs(args) {
  if (args.candidateDir) {
    return fs.existsSync(args.candidateDir) ? [args.candidateDir] : [];
  }
  if (!args.candidateRoot || !fs.existsSync(args.candidateRoot)) return [];
  return fs.readdirSync(args.candidateRoot)
    .map((name) => path.join(args.candidateRoot, name))
    .filter((candidatePath) => fs.statSync(candidatePath).isDirectory())
    .sort();
}

function findCandidates(candidateDirs, slug) {
  return candidateDirs.flatMap((candidateDir) => {
    const pass = path.basename(candidateDir);
    const files = fs.readdirSync(candidateDir)
      .filter((name) => name === `${slug}.png` || name.startsWith(`${slug}-`) && name.endsWith('.png'))
      .sort();

    return files.map((name, index) => ({
      id: `${slug}::${pass}::${index + 1}`,
      label: `${formatPassLabel(pass)} candidate ${index + 1}`,
      pass,
      src: path.posix.join('..', 'tmp', 'poem-image-candidates', pass, name),
      file: path.relative(repoRoot, path.join(candidateDir, name)),
      model: 'gpt-image-2'
    }));
  });
}

function formatPassLabel(pass) {
  const match = pass.match(/^pass-0*(\d+)$/);
  if (!match) return pass;
  return `Pass ${match[1]}`;
}

function parsePassNumber(pass) {
  const match = String(pass || '').match(/^pass-0*(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function renderMarkdown(items) {
  const lines = [
    '# Poem Image Prompt Drafts',
    '',
    'Draft prompt catalog for generating poem companion images with `gpt-image-2`.',
    '',
    'These prompts intentionally give the image model poem context and exact selected lines, then only light stylistic guidance. The goal is to trust the model aesthetic judgment while supplying enough literary context to make a good image.',
    '',
    'Shared constraints for every image: no visible text, handwriting, captions, book covers, logos, signatures, watermarks, frames, or UI. Create square companion images for a quiet literary archive, not posters or literal book covers.',
    ''
  ];

  for (const item of items) {
    lines.push(
      `## ${item.title}`,
      '',
      `Slug: ${item.slug}`,
      '',
      `Author: ${item.author}`,
      '',
      'Selected lines:',
      '',
      '```',
      item.selectedLines,
      '```',
      '',
      `Context: ${item.context}`,
      '',
      `Style guidance: ${item.style}.`,
      '',
      'Prompt:',
      '',
      '>',
      item.prompt.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n'),
      ''
    );
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderReviewData(items, feedback) {
  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    prompts: items,
    reviewState: buildEmbeddedReviewState(feedback)
  };

  return [
    'window.POEM_IMAGE_REVIEW_DATA = ',
    JSON.stringify(payload, null, 2),
    ';\n'
  ].join('');
}

function buildEmbeddedReviewState(feedback) {
  if (!feedback.payload) return null;
  const state = {
    version: 3,
    updatedAt: feedback.payload.exportedAt || new Date().toISOString(),
    importedFromFeedback: true,
    items: {},
    candidates: {}
  };

  for (const item of feedback.payload.items || []) {
    const itemState = {};
    if (item.status && item.status !== 'review') itemState.status = item.status;
    if (item.feedback) itemState.feedback = item.feedback;
    if (item.promptEdited && item.prompt) itemState.prompt = item.prompt;
    if (Object.keys(itemState).length > 0) {
      itemState.updatedAt = item.updatedAt || state.updatedAt;
      state.items[item.slug] = itemState;
    }

    for (const candidate of item.candidates || []) {
      if (!candidate.id || !candidate.feedback) continue;
      const candidateState = {};
      if (candidate.feedback.status && candidate.feedback.status !== 'review') {
        candidateState.status = candidate.feedback.status;
      }
      if (candidate.feedback.note) candidateState.note = candidate.feedback.note;
      if (Object.keys(candidateState).length > 0) {
        candidateState.updatedAt = candidate.feedback.updatedAt || state.updatedAt;
        state.candidates[candidate.id] = candidateState;
      }
    }
  }

  return state;
}

function renderBatchJsonl(items) {
  return `${items.map((item) => JSON.stringify({
    prompt: item.prompt,
    out: `${item.slug}.png`,
    n: item.n || 1,
    size: '1024x1024',
    quality: 'medium',
    output_format: 'png'
  })).join('\n')}\n`;
}

function buildSummary(items, batchItems, feedback, args) {
  const candidateCounts = {};
  let acceptedPoems = 0;
  let developingPoems = 0;
  let unreviewedPoems = 0;

  for (const item of items) {
    const statuses = (item.candidates || []).map((candidate) => {
      const status = feedback.byCandidate.get(candidate.id)?.status || 'review';
      candidateCounts[status] = (candidateCounts[status] || 0) + 1;
      return { status, pass: parsePassNumber(candidate.pass) };
    });
    const hasKeep = statuses.some((candidate) => candidate.status === 'keep');
    if (hasKeep) acceptedPoems += 1;
    if (!hasKeep) developingPoems += 1;
    if (statuses.some((candidate) => candidate.status === 'review')) unreviewedPoems += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    feedbackJson: args.feedbackJson ? path.relative(repoRoot, args.feedbackJson) : '',
    pass: args.pass,
    totalPoems: items.length,
    acceptedPoems,
    developingPoems,
    unreviewedPoems,
    candidateCounts,
    batchPrompts: batchItems.map((item) => item.slug)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const feedback = loadFeedback(args.feedbackJson);
  const items = loadPromptItems(args, feedback);

  if (items.length !== SPECS.length) {
    throw new Error(`Expected ${SPECS.length} prompt specs, got ${items.length}`);
  }

  let batchItems = items;
  if (args.onlyDeveloping) {
    batchItems = items.filter((item) => feedback.developingSlugs.has(item.slug));
  } else if (args.onlyRejected) {
    batchItems = items.filter((item) => feedback.rejectedSlugs.has(item.slug));
  }

  if (args.write) {
    fs.writeFileSync(promptMarkdownPath, renderMarkdown(items));
    fs.writeFileSync(reviewDataPath, renderReviewData(items, feedback));
  }

  if (args.batchJson) {
    fs.mkdirSync(path.dirname(args.batchJson), { recursive: true });
    fs.writeFileSync(args.batchJson, renderBatchJsonl(batchItems));
  }

  if (args.summaryJson) {
    fs.mkdirSync(path.dirname(args.summaryJson), { recursive: true });
    fs.writeFileSync(args.summaryJson, `${JSON.stringify(buildSummary(items, batchItems, feedback, args), null, 2)}\n`);
  }

  const unmatched = items.filter((item) => item.collection === 'unmatched').map((item) => item.slug);
  console.log(JSON.stringify({
    prompts: items.length,
    batchPrompts: batchItems.length,
    candidates: items.reduce((sum, item) => sum + item.candidates.length, 0),
    unmatched
  }, null, 2));
}

main();
