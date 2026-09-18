// src/app/markdown.tsx
// `Preview`'s renderer. Scope decided and closed (05-screens.md §4): ATX headings, bullet and
// ordered lists, fenced and inline code, bold, italic, links restricted to http/https schemes,
// paragraphs. Everything outside that subset renders as its literal source text, unstyled.
//
// Returns React elements ONLY — never `dangerouslySetInnerHTML`. Raw HTML pasted into a note
// (`<script>...`) is therefore inert by construction: React treats it as a text node, not markup.
// There is no markdown dependency in this project and none is being added here.

import type { ReactNode } from 'react'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string }

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const ORDERED = /^\d+\.\s+(.*)$/
const FENCE = /^```/

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
      i += 1
      continue
    }

    if (FENCE.test(line)) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // consume closing fence, if any
      blocks.push({ kind: 'code', text: codeLines.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '').length, text: heading[2] ?? '' })
      i += 1
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      const items = [bullet[1] ?? '']
      i += 1
      let next: RegExpExecArray | null
      while (i < lines.length && (next = BULLET.exec(lines[i] ?? '')) !== null) {
        items.push(next[1] ?? '')
        i += 1
      }
      blocks.push({ kind: 'list', ordered: false, items })
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered !== null) {
      const items = [ordered[1] ?? '']
      i += 1
      let next: RegExpExecArray | null
      while (i < lines.length && (next = ORDERED.exec(lines[i] ?? '')) !== null) {
        items.push(next[1] ?? '')
        i += 1
      }
      blocks.push({ kind: 'list', ordered: true, items })
      continue
    }

    // Paragraph: consecutive non-blank lines that don't start a different block.
    const paragraphLines = [line]
    i += 1
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !FENCE.test(lines[i] ?? '') &&
      HEADING.exec(lines[i] ?? '') === null &&
      BULLET.exec(lines[i] ?? '') === null &&
      ORDERED.exec(lines[i] ?? '') === null
    ) {
      paragraphLines.push(lines[i] ?? '')
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') })
  }

  return blocks
}

/** Inline: code, links (http/https only), bold, then italic — in that precedence order, checked
 *  left to right over the remaining text. Anything that matches nothing is literal text. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let plain = ''
  let counter = 0
  let i = 0

  const flushPlain = (): void => {
    if (plain !== '') {
      nodes.push(plain)
      plain = ''
    }
  }

  while (i < text.length) {
    const rest = text.slice(i)
    let m: RegExpExecArray | null

    if ((m = /^`([^`]+)`/.exec(rest)) !== null) {
      flushPlain()
      nodes.push(<code key={`${keyPrefix}-${counter++}`}>{m[1]}</code>)
      i += m[0].length
      continue
    }

    if ((m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest)) !== null) {
      flushPlain()
      nodes.push(
        <a key={`${keyPrefix}-${counter++}`} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>,
      )
      i += m[0].length
      continue
    }

    if ((m = /^\*\*([^*]+)\*\*/.exec(rest)) !== null) {
      flushPlain()
      nodes.push(<strong key={`${keyPrefix}-${counter++}`}>{m[1]}</strong>)
      i += m[0].length
      continue
    }

    if ((m = /^\*([^*]+)\*/.exec(rest)) !== null) {
      flushPlain()
      nodes.push(<em key={`${keyPrefix}-${counter++}`}>{m[1]}</em>)
      i += m[0].length
      continue
    }

    if ((m = /^_([^_]+)_/.exec(rest)) !== null) {
      flushPlain()
      nodes.push(<em key={`${keyPrefix}-${counter++}`}>{m[1]}</em>)
      i += m[0].length
      continue
    }

    plain += text[i]
    i += 1
  }

  flushPlain()
  return nodes
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `b${index}`
  switch (block.kind) {
    case 'heading': {
      const Tag = (`h${block.level}` as unknown) as 'h1'
      return <Tag key={key}>{renderInline(block.text, key)}</Tag>
    }
    case 'code':
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const items = block.items.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>)
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.text, key)}</p>
  }
}

export function Preview({ source }: { source: string }): ReactNode {
  const blocks = parseBlocks(source)
  return <div className="preview">{blocks.map(renderBlock)}</div>
}
