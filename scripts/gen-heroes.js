/*
 * A hero for every face.
 *
 * The portrait pack shipped 45 usable portraits and the game defined four
 * heroes, so 41 faces sat in `public/` unreachable — a portrait is matched to a
 * hero by FILENAME, exactly like potion art, so a face is only ever seen if a
 * hero happens to be called the same thing.
 *
 * This gives each spare portrait a hero, renames the file to that hero's id, and
 * writes the roster and the English strings. The four hand-written heroes are
 * left exactly as they are — they have blurbs someone wrote on purpose, and a
 * generator has no business improving on them.
 *
 * Everything is derived from the portrait's position in a sorted list rather
 * than from a random seed, so re-running produces the same roster and a hero
 * cannot silently change biome between builds — which would strand a save that
 * had recruited them.
 *
 *   node scripts/gen-heroes.js            # plan only
 *   node scripts/gen-heroes.js --apply
 */
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const PORTRAITS = 'art/portraits/heroes';

/*
 * Names, and a line about each.
 *
 * Blurbs stay clear of WHERE anyone works: affinity is assigned below from the
 * position in this list, so a blurb that named a swamp would contradict the
 * biome half the time. What they describe is the person.
 */
const PEOPLE = [
  ['bexley', 'Bexley', 'Keeps a running list of everything owed to them. It is long.'],
  ['corvin', 'Corvin', 'Talks to the birds. Insists this is a professional technique.'],
  ['dalla', 'Dalla', 'Slow to leave, slower to turn back. Arrives with everything.'],
  ['emrick', 'Emrick', 'Was a cooper once. Still judges every barrel he passes.'],
  ['fenna', 'Fenna', 'Sleeps anywhere, wakes at anything. A useful pair of habits.'],
  ['garrow', 'Garrow', 'Carries twice what he is asked to and mentions it twice as often.'],
  ['hesper', 'Hesper', 'Draws maps that are wrong in interesting and consistent ways.'],
  ['ivo', 'Ivo', 'Has never once been the first back, or the last.'],
  ['jorun', 'Jorun', 'Reads weather off the light. Has been right more than not.'],
  ['kestrel', 'Kestrel', 'Fast, and aware of it. Slower company finds this tiring.'],
  ['lomax', 'Lomax', 'Would rather go round than through, and usually saves time.'],
  ['mirren', 'Mirren', 'Notices the thing everyone else walked past an hour ago.'],
  ['nessa', 'Nessa', 'Counts everything into the bag and everything out of it.'],
  ['oswin', 'Oswin', 'Cheerful in bad weather, which others find either warming or unbearable.'],
  ['perrin', 'Perrin', 'Trades for what the party needs before anyone knows they need it.'],
  ['quill', 'Quill', 'Writes it all down. Will read it back to you, unprompted.'],
  ['rhosyn', 'Rhosyn', 'Handles everything as though it might be worth something. Often right.'],
  ['sable', 'Sable', 'Speaks about twice a day and is worth listening to both times.'],
  ['tarn', 'Tarn', 'Built like a doorway and about as easy to move.'],
  ['ulla', 'Ulla', 'Was a cook. The party eats well and complains about nothing else.'],
  ['verity', 'Verity', 'Cannot be talked into a shortcut. This has saved several lives.'],
  ['wick', 'Wick', 'Keeps a lamp burning long after the others have given up on the light.'],
  ['yarrow', 'Yarrow', 'Patches people up on the trail and pretends it was nothing.'],
  ['zeph', 'Zeph', 'Young, quick, and entirely convinced of both.'],
  ['alder', 'Alder', 'The oldest hand here, and still the one who packs properly.'],
  ['briar', 'Briar', 'Comes back scratched to pieces holding exactly what was asked for.'],
  ['calla', 'Calla', 'Hums the whole way out. Silent the whole way back.'],
  ['dunn', 'Dunn', 'Never hurries and has somehow never been late.'],
  ['elowen', 'Elowen', 'Talks to the plants. The plants appear to cooperate.'],
  ['fitch', 'Fitch', 'Can get into anywhere. Getting him out again is the harder trick.'],
  ['greer', 'Greer', 'Argues with the plan, follows it exactly, then says nothing.'],
  ['halla', 'Halla', 'Laughs at the worst moments, which turns out to help.'],
  ['ines', 'Ines', 'Keeps the party together by refusing to acknowledge that it might not.'],
  ['joss', 'Joss', 'Lost a boot on the first outing and has told the story ever since.'],
  ['karrin', 'Karrin', 'Tests every branch before she trusts it, including the ones indoors.'],
  ['linnet', 'Linnet', 'Small, quiet, and back before anyone noticed she had gone.'],
  ['marlow', 'Marlow', 'Would like it on record that he did suggest the other route.'],
];

/** Flavour, cycled so no biome ends up staffed entirely by one kind. */
const CRAFT = ['delver', 'hunter', 'forager'];

/** Favourites that suit the place, so a gift reads as thoughtful. */
const FAVOURITES = {
  emberwaste: ['ignisTerra', 'ignisAqua', 'ignis', 'ignisUmbra', 'ignisTerraAerUmbra'],
  mirefen: ['aquaTerra', 'aquaUmbra', 'aqua', 'aquaTerraAer', 'aquaUmbra'],
  sunkenBarrow: ['terraUmbra', 'umbra', 'ignisUmbra', 'aquaAerUmbra', 'aerUmbra'],
  skyreachSpires: ['aquaAer', 'aer', 'terraAer', 'ignisAer', 'aerUmbra'],
};

const heroes = JSON.parse(readFileSync('src/data/heroes.json', 'utf8'));
const strings = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));
const biomes = heroes.biomes.map((biome) => biome.id);
const recipes = new Set(JSON.parse(readFileSync('src/data/recipes.json', 'utf8')).map((r) => r.id));

for (const list of Object.values(FAVOURITES)) {
  for (const id of list) {
    if (!recipes.has(id)) throw new Error(`favourite ${id} is not a recipe`);
  }
}

const files = readdirSync(PORTRAITS).filter((f) => /\.png$/i.test(f));
const rosterIds = new Set(heroes.roster.map((hero) => hero.id));

/*
 * Portraits nobody is using, oldest pack name first.
 *
 * Sorted so the mapping from face to hero is stable: the assignment must not
 * depend on the order the filesystem happened to hand the directory back in.
 */
const free = files
  .map((f) => f.replace(/\.png$/i, ''))
  .filter((id) => !rosterIds.has(id))
  .sort();

// Heroes already written down but still faceless get first claim on the pack.
const faceless = heroes.roster.filter((hero) => !files.some((f) => f === `${hero.id}.png`));

const renames = [];
const added = [];

faceless.forEach((hero, index) => {
  if (index >= free.length) return;
  renames.push([free[index], hero.id]);
});

const spare = free.slice(faceless.length);

spare.forEach((portrait, index) => {
  const person = PEOPLE[index];
  if (!person) return;
  const [id, name, blurb] = person;
  const affinity = biomes[index % biomes.length];
  const traits = [CRAFT[index % CRAFT.length]];
  // Kept uncommon, and never together: a lucky hero who is also fragile reads
  // as neither.
  if (index % 4 === 1) traits.push('lucky');
  else if (index % 5 === 2) traits.push('fragile');

  renames.push([portrait, id]);
  added.push({
    def: {
      id,
      affinity,
      traits,
      favourite: FAVOURITES[affinity][index % FAVOURITES[affinity].length],
      baseLevel: 1 + (index % 5),
    },
    name,
    blurb,
  });
});

console.log(`${files.length} portraits, ${rosterIds.size} heroes already defined`);
console.log(`${faceless.length} existing heroes given a face, ${added.length} heroes created`);
console.log(`${free.length - renames.length} portraits still spare\n`);
for (const [from, to] of renames.slice(0, 8)) console.log(`  ${from.padEnd(20)} -> ${to}`);
console.log(`  ... ${renames.length} renames`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply.');
  process.exit(0);
}

for (const [from, to] of renames) {
  renameSync(path.join(PORTRAITS, `${from}.png`), path.join(PORTRAITS, `${to}.png`));
}

heroes.roster.push(...added.map((entry) => entry.def));
writeFileSync('src/data/heroes.json', `${JSON.stringify(heroes, null, 2)}\n`, 'utf8');

/*
 * Names go in beside the other heroes, not at the end of the file.
 *
 * en.json is grouped by subject and read by people; appending 74 keys after the
 * last unrelated string would work and would also make the file worse.
 */
const merged = {};
for (const [key, value] of Object.entries(strings)) {
  merged[key] = value;
  if (key !== 'hero.tobrin.blurb') continue;
  for (const entry of added) {
    merged[`hero.${entry.def.id}`] = entry.name;
    merged[`hero.${entry.def.id}.blurb`] = entry.blurb;
  }
}
writeFileSync('src/i18n/en.json', `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

console.log(`\nroster now ${heroes.roster.length} heroes`);
console.log('run `node scripts/art-build.js` to rebuild the portraits');
