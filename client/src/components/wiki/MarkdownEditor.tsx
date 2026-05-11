import { useCallback, useRef } from 'react'
import MDEditor, { MDEditorProps } from '@uiw/react-md-editor'
import { message } from 'antd'
import { wikiApi } from '../../services/wikiService'

/**
 * Wiki Markdown 编辑器封装：在 @uiw/react-md-editor 基础上增加
 * - 剪贴板粘贴图片（截图 Ctrl+V）
 * - 拖拽图片到编辑区
 * 上传成功后在光标位置插入 ![](url)，存储仍是干净的 Markdown。
 */
interface Props extends Omit<MDEditorProps, 'onChange'> {
  value: string
  onChange: (v: string) => void
  height?: number | string
}

export default function MarkdownEditor({ value, onChange, height = '100%', ...rest }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const uploadingRef = useRef(false)
  // 用 ref 记录最新值，避免上传期间用户继续输入丢失
  const valueRef = useRef(value)
  valueRef.current = value

  const insertAtCursor = useCallback((snippet: string) => {
    const ta = wrapperRef.current?.querySelector('textarea') as HTMLTextAreaElement | null
    if (!ta) {
      onChange((valueRef.current || '') + snippet)
      return
    }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? ta.value.length
    const next = ta.value.slice(0, start) + snippet + ta.value.slice(end)
    onChange(next)
    // 下一帧把光标移到插入内容之后
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + snippet.length
      ta.setSelectionRange(pos, pos)
    })
  }, [onChange])

  const uploadAndInsert = useCallback(async (files: File[]) => {
    if (uploadingRef.current) return
    const images = files.filter(f => f.type.startsWith('image/'))
    if (images.length === 0) return
    uploadingRef.current = true
    const placeholderId = `uploading-${Date.now()}`
    const placeholder = `![上传中…](${placeholderId})`
    insertAtCursor(placeholder)
    try {
      const urls: string[] = []
      for (const img of images) {
        const r = await wikiApi.uploadInlineImage(img)
        if (r?.data?.url) urls.push(r.data.url)
      }
      // 用真实 URL 替换占位符
      const md = urls.map(u => `![](${u})`).join('\n\n')
      onChange((valueRef.current || '').replace(placeholder, md))
    } catch (e: any) {
      message.error(e?.message || '图片上传失败')
      onChange((valueRef.current || '').replace(placeholder, ''))
    } finally {
      uploadingRef.current = false
    }
  }, [insertAtCursor, onChange])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items || [])
    const imageFiles: File[] = []
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      uploadAndInsert(imageFiles)
    }
  }, [uploadAndInsert])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
    if (files.length > 0) {
      e.preventDefault()
      uploadAndInsert(files)
    }
  }, [uploadAndInsert])

  return (
    <div
      ref={wrapperRef}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ height: '100%' }}
    >
      <MDEditor
        value={value}
        onChange={(v) => onChange(v || '')}
        height={height as any}
        preview="live"
        visibleDragbar={false}
        {...rest}
      />
    </div>
  )
}
