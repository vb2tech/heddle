import type { ReactNode } from 'react'

/**
 * A small, dependency-free markdown renderer for the summary view.
 *
 * The first version stripped markdown to flat text, which destroyed the very
 * structure that makes prose skimmable: lists became run-on sentences and
 * headings became indistinguishable from body text. Rendering the structure is
 * what actually improves readability — the markup was never the problem.
 *
 * Deliberately narrow: it covers what Claude actually writes (headings, bullet
 * and numbered lists, bold, inline code, fenced code, tables, quotes) and
 * ignores everything else rather than pretending to be CommonMark.
 */

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string; level: number }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; rows: string[][] }

const H = /^(#{1,6})\s+(.*)$/
const UL = /^\s*[-*+]\s+(.*)$/
const OL = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const FENCE = /^\s*```/
const TABLE_ROW = /^\s*\|(.+)\|\s*$/
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/

function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    if (FENCE.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      blocks.push({ kind: 'code', lines: body })
      continue
    }

    const h = H.exec(line)
    if (h) {
      blocks.push({ kind: 'h', level: h[1].length, text: h[2] })
      i++
      continue
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        if (!TABLE_SEP.test(lines[i])) {
          rows.push(TABLE_ROW.exec(lines[i])![1].split('|').map((c) => c.trim()))
        }
        i++
      }
      if (rows.length) blocks.push({ kind: 'table', rows })
      continue
    }

    if (UL.test(line)) {
      const items: string[] = []
      while (i < lines.length && UL.test(lines[i])) items.push(UL.exec(lines[i++])![1])
      blocks.push({ kind: 'ul', items })
      continue
    }

    if (OL.test(line)) {
      const items: string[] = []
      while (i < lines.length && OL.test(lines[i])) items.push(OL.exec(lines[i++])![1])
      blocks.push({ kind: 'ol', items })
      continue
    }

    if (QUOTE.test(line)) {
      const parts: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) parts.push(QUOTE.exec(lines[i++])![1])
      blocks.push({ kind: 'quote', text: parts.join(' ') })
      continue
    }

    // Plain paragraph: soft-wrapped lines join into one flowing block.
    const parts: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !H.test(lines[i]) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !TABLE_ROW.test(lines[i])
    ) {
      parts.push(lines[i++].trim())
    }
    blocks.push({ kind: 'p', text: parts.join(' ') })
  }

  return blocks
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)]*\))/g

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0

  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${key}-${n++}`
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) out.push(tok.slice(1, tok.indexOf(']')))
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const CODE_PREVIEW_LINES = 12

export default function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source)

  return (
    <>
      {blocks.map((b, i) => {
        const key = `b${i}`
        switch (b.kind) {
          case 'h':
            return (
              <div className={`md-h md-h${Math.min(b.level, 3)}`} key={key}>
                {inline(b.text, key)}
              </div>
            )
          case 'ul':
            return (
              <ul className="md-list" key={key}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol className="md-list" key={key}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </ol>
            )
          case 'code': {
            const shown = b.lines.slice(0, CODE_PREVIEW_LINES)
            const rest = b.lines.length - shown.length
            return (
              <pre className="md-code" key={key}>
                {shown.join('\n')}
                {rest > 0 && <span className="md-more">{`\n… ${rest} more line${rest === 1 ? '' : 's'}`}</span>}
              </pre>
            )
          }
          case 'quote':
            return (
              <blockquote className="md-quote" key={key}>
                {inline(b.text, key)}
              </blockquote>
            )
          case 'table':
            return (
              <div className="md-tablewrap" key={key}>
                <table className="md-table">
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) =>
                          r === 0 ? <th key={c}>{inline(cell, `${key}-${r}-${c}`)}</th> : <td key={c}>{inline(cell, `${key}-${r}-${c}`)}</td>,
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return (
              <p className="md-p" key={key}>
                {inline(b.text, key)}
              </p>
            )
        }
      })}
    </>
  )
}
