/**
 * Incremental JSONL line splitter over a byte stream.
 *
 * TextDecoder with {stream: true} handles multi-byte UTF-8 characters that
 * straddle chunk boundaries; this module handles lines that straddle chunk
 * boundaries. Both must be correct or downstream content hashes silently
 * corrupt and every diff goes wrong.
 */

export interface Line {
  /** 1-based line number within the source. */
  no: number;
  text: string;
}

export async function* splitLines(input: AsyncIterable<Uint8Array>): AsyncIterable<Line> {
  const decoder = new TextDecoder('utf-8');
  let rest = '';
  let no = 0;

  for await (const chunk of input) {
    rest += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = rest.indexOf('\n')) !== -1) {
      let line = rest.slice(0, idx);
      rest = rest.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      no++;
      if (line.length > 0) yield { no, text: line };
    }
  }

  // Flush the decoder (a trailing multi-byte char may still be buffered).
  rest += decoder.decode();
  if (rest.length > 0) {
    no++;
    const line = rest.endsWith('\r') ? rest.slice(0, -1) : rest;
    if (line.length > 0) yield { no, text: line };
  }
}
