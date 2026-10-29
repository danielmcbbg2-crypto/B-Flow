// Keeping suppliers' names out of what customers see: they buy from Next Phase Maintenance.

/** Letters and digits only, lower case: "Danish Building Supplies" and "danishbuildingsupplies.com.au" compare alike. */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** What a supplier is called, squashed: from their name and their website (without www. or .com.au). */
export function supplierKeys(supplier: string, url: string): string[] {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '').split('.')[0]
  } catch {
    /* no usable link */
  }
  return [...new Set([squash(supplier.replace(/\.(com|net|org)(\.au)?$/i, '')), squash(host)].filter((k) => k.length >= 4))]
}

/**
 * The text without the supplier's name (customers buy from Next Phase Maintenance, not them): any
 * run of up to 4 words that spells it, however it's spaced or cased.
 */
export function withoutSupplier(text: string, keys: string[]): string {
  if (!keys.length) return text
  return text
    .split('\n')
    .map((line) => {
      const words = line.split(/(\s+)/)
      const out: string[] = []
      for (let i = 0; i < words.length; i++) {
        // A match starts and ends on a word (odd n: word, space, word…), keeping trailing punctuation.
        let skip = 0
        if (words[i].trim()) for (let n = 1; n <= 7 && i + n <= words.length; n += 2) if (keys.includes(squash(words.slice(i, i + n).join('')))) skip = n
        if (!skip) {
          out.push(words[i])
          continue
        }
        out.push(words[i + skip - 1].match(/[^a-z0-9]*$/i)![0])
        i += skip - 1
      }
      return out.join('').replace(/\s{2,}/g, ' ').replace(/^[\s,–-]+|[\s,–-]+$/g, '').replace(/\s+([,.])/g, '$1')
    })
    .join('\n')
}
