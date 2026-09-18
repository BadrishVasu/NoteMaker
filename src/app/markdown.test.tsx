import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Preview } from './markdown'

describe('Preview', () => {
  it('renders ATX headings at their level', () => {
    render(<Preview source={'# Title\n## Subtitle'} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Subtitle' })).toBeInTheDocument()
  })

  it('renders a bullet list', () => {
    render(<Preview source={'- one\n- two'} />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['one', 'two'])
  })

  it('renders an ordered list', () => {
    render(<Preview source={'1. first\n2. second'} />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
  })

  it('renders a fenced code block literally, without inline parsing', () => {
    render(<Preview source={'```\n**not bold**\n```'} />)
    expect(screen.getByText('**not bold**').tagName).toBe('CODE')
  })

  it('renders inline code', () => {
    const { container } = render(<Preview source={'Use `npm test` here'} />)
    expect(container.querySelector('code')?.textContent).toBe('npm test')
  })

  it('renders bold and italic', () => {
    const { container } = render(<Preview source={'**bold** and *italic*'} />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
  })

  it('renders an http(s) link as a real anchor', () => {
    render(<Preview source={'[site](https://example.com)'} />)
    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders a non-http(s) scheme link as literal source text, not an anchor', () => {
    render(<Preview source={'[click](javascript:alert(1))'} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/\[click\]\(javascript:alert\(1\)\)/)).toBeInTheDocument()
  })

  it('never uses dangerouslySetInnerHTML: raw HTML in a note is inert text', () => {
    const { container } = render(<Preview source={'<script>alert(1)</script>'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('renders plain paragraphs', () => {
    render(<Preview source={'Just a paragraph of text.'} />)
    expect(screen.getByText('Just a paragraph of text.').tagName).toBe('P')
  })
})
