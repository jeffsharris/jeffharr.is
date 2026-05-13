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

function parseArgs(argv) {
  const args = {
    write: false,
    batchJson: '',
    candidateDir: DEFAULT_CANDIDATE_DIR
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

function buildPrompt({ title, author, selectedLines, context, style, avoid }) {
  return [
    `Create one square companion image for the poem "${title}" by ${author}.`,
    '',
    'Use these exact selected lines as the source passage:',
    '"""',
    selectedLines,
    '"""',
    '',
    `Context: ${context}`,
    '',
    'Goal: Give a viewer a beautiful visual entry point into this passage for a quiet literary archive. Do not mechanically illustrate every noun. Use the poem context and your own strong aesthetic judgment to choose the image that best carries the feeling, visual tension, and imaginative world of the selected lines.',
    '',
    `Light style guidance: ${style}.`,
    '',
    `Constraints: no visible text, handwriting, captions, book covers, logos, signatures, watermarks, frames, or UI; ${avoid}.`
  ].join('\n');
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const collections = new Map();
  for (const slug of manifest.memorized || []) collections.set(slug, 'memorized');
  for (const slug of manifest.learning || []) collections.set(slug, 'learning');
  return collections;
}

function loadPromptItems(candidateDir) {
  const collections = loadManifest();
  return SPECS.map((spec, index) => {
    const markdown = fs.readFileSync(path.join(poemsDir, `${spec.slug}.md`), 'utf8');
    const poem = parsePoem(markdown);
    const selectedLines = extractLines(poem.bodyLines, spec.lines);
    const prompt = buildPrompt({
      title: poem.title,
      author: poem.author,
      selectedLines,
      context: spec.context,
      style: spec.style,
      avoid: spec.avoid
    });
    return {
      order: index + 1,
      slug: spec.slug,
      title: poem.title,
      author: poem.author,
      collection: collections.get(spec.slug) || 'unmatched',
      selectedLines,
      context: spec.context,
      style: spec.style,
      avoid: spec.avoid,
      prompt,
      candidates: findCandidates(candidateDir, spec.slug)
    };
  });
}

function findCandidates(candidateDir, slug) {
  if (!candidateDir || !fs.existsSync(candidateDir)) return [];
  const files = fs.readdirSync(candidateDir)
    .filter((name) => name === `${slug}.png` || name.startsWith(`${slug}-`) && name.endsWith('.png'))
    .sort();

  return files.map((name, index) => ({
    id: `${slug}::${path.basename(candidateDir)}::${index + 1}`,
    label: `Candidate ${index + 1}`,
    src: path.posix.join('..', 'tmp', 'poem-image-candidates', path.basename(candidateDir), name),
    file: path.relative(repoRoot, path.join(candidateDir, name)),
    model: 'gpt-image-2'
  }));
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

function renderReviewData(items) {
  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    prompts: items
  };

  return [
    'window.POEM_IMAGE_REVIEW_DATA = ',
    JSON.stringify(payload, null, 2),
    ';\n'
  ].join('');
}

function renderBatchJsonl(items) {
  return `${items.map((item) => JSON.stringify({
    prompt: item.prompt,
    out: `${item.slug}.png`,
    n: 1,
    size: '1024x1024',
    quality: 'medium',
    output_format: 'png'
  })).join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const items = loadPromptItems(args.candidateDir);

  if (items.length !== SPECS.length) {
    throw new Error(`Expected ${SPECS.length} prompt specs, got ${items.length}`);
  }

  if (args.write) {
    fs.writeFileSync(promptMarkdownPath, renderMarkdown(items));
    fs.writeFileSync(reviewDataPath, renderReviewData(items));
  }

  if (args.batchJson) {
    fs.mkdirSync(path.dirname(args.batchJson), { recursive: true });
    fs.writeFileSync(args.batchJson, renderBatchJsonl(items));
  }

  const unmatched = items.filter((item) => item.collection === 'unmatched').map((item) => item.slug);
  console.log(JSON.stringify({
    prompts: items.length,
    candidates: items.reduce((sum, item) => sum + item.candidates.length, 0),
    unmatched
  }, null, 2));
}

main();
