import { useMemo } from 'react'
import { Empty, Typography } from 'antd'

const { Text } = Typography

export interface TocItem {
  level: number
  text: string
  id: string
}

export function extractToc(markdown: string): TocItem[] {
  if (!markdown) return []
  const lines = markdown.split('\n')
  const items: TocItem[] = []
  let inFence = false
  for (const line of lines) {
    if (line.startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    const m = line.match(/^(#{1,3})\s+(.+)$/)
    if (m) {
      const level = m[1].length
      const text = m[2].trim()
      const id = encodeURIComponent(
        text.toLowerCase().replace(/[\s\/\\?#&=+%]+/g, '-').replace(/^-+|-+$/g, '')
      )
      items.push({ level, text, id })
    }
  }
  return items
}

export default function TocPanel({ markdown }: { markdown?: string }) {
  const items = useMemo(() => extractToc(markdown || ''), [markdown])
  if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无大纲" />
  return (
    <div style={{ fontSize: 13 }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            paddingLeft: (it.level - 1) * 12,
            marginBottom: 4,
            cursor: 'pointer'
          }}
          onClick={() => {
            const el = document.getElementById(it.id)
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          <Text style={{ color: it.level === 1 ? '#0d9488' : '#555' }}>{it.text}</Text>
        </div>
      ))}
    </div>
  )
}
