// Screen-name filter for the big screen. Catches common slurs/profanity incl. leetspeak and spacing tricks.
// Not perfect on purpose (no false hits on names like "Dickens" or "Cassandra"); the host can still remove anyone.
const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '!': 'i', '|': 'i', '@': 'a', $: 's', '+': 't', '€': 'e' };
// Blocked anywhere in the name, even inside other words.
const ANYWHERE = ['fuck', 'shit', 'cunt', 'nigg', 'niga', 'faggot', 'fagot', 'bitch', 'whore', 'slut', 
  'porn', 'penis', 'vagina', 'dildo', 'pussy', 'hitler', 'retard', 'twat', 'wank', 'jizz', 'asshole', 'dickhead',
  'cocksuck', 'motherf', 'blowjob', 'handjob', 'cumshot', 'kike', 'chink', 'tranny', 'molest', 'boner',
  'dumbass', 'jackass', 'smartass', 'bigdick', 'kkk', 'bastard', 'testicle', 'scrotum', 'clit', 'orgasm', 'horny', 'milf'];
// Blocked only as a whole word (so "class", "hancock", "document" are fine).
const WORDS = ['ass', 'arse', 'dick', 'cock', 'cum', 'fag', 'tit', 'tits', 'boob', 'boobs', 'anal', 'anus', 'sex', 'sexy',
  'hoe', 'ho', 'rape', 'nut', 'nuts', 'balls', 'coon', 'gook', 'wop', 'butt', 'piss', 'fuk', 'fuq', 'rapist', 'nazi', 'nazis', 'spic', 'pedo', 'pedos'];
const ANY_RE = new RegExp(ANYWHERE.join('|'));
const normalize = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[0-9!|@$+€]/g, c => LEET[c] || c);
const squash = (s) => s.replace(/(.)\1+/g, '$1');   // "fuuuck" -> "fuck"
function isRudeName(name) {
  const n = normalize(name);
  const compact = n.replace(/[^a-z]/g, '');
  if (ANY_RE.test(compact) || ANY_RE.test(squash(compact))) return true;
  const words = n.split(/[^a-z]+/).filter(Boolean);
  return words.some(w => WORDS.includes(w) || WORDS.includes(squash(w)));
}
module.exports = { isRudeName };
