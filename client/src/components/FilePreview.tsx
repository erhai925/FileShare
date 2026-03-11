import { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Spin, message, Button } from 'antd'
import { DownloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { renderAsync } from 'docx-preview'
import { useAuthStore } from '../stores/authStore'

interface FilePreviewProps {
  fileId: number | null
  fileName?: string
  mimeType?: string
  visible: boolean
  onClose: () => void
}

export default function FilePreview({ fileId, fileName, mimeType, visible, onClose }: FilePreviewProps) {
  const [loading, setLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewable, setPreviewable] = useState(true)
  const [, setDownloadUrl] = useState<string | null>(null)
  const [actualMimeType, setActualMimeType] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<string | null>(null) // 'image' | 'pdf' | 'office' | 'text'
  const [textContent, setTextContent] = useState<string | null>(null) // 文本文件内容
  const [previewError, setPreviewError] = useState<string | null>(null) // 预览错误信息
  const [isLocalhostEnv, setIsLocalhostEnv] = useState(false) // 是否是本地环境
  const [iframeLoadTimeout, setIframeLoadTimeout] = useState<NodeJS.Timeout | null>(null) // iframe 加载超时定时器
  const docxContainerRef = useRef<HTMLDivElement>(null)
  const [docxLoading, setDocxLoading] = useState(false)
  const { token } = useAuthStore()

  useEffect(() => {
    if (visible && fileId) {
      loadPreview()
    } else {
      // 清理预览URL
      setPreviewUrl((prevUrl) => {
        if (prevUrl && prevUrl.startsWith('blob:')) {
          URL.revokeObjectURL(prevUrl)
        }
        return null
      })
      setDownloadUrl(null)
      setActualMimeType(null)
      setPreviewType(null)
      setPreviewError(null)
      setTextContent(null)
      setIsLocalhostEnv(false)
    }

    // 清理函数：组件卸载或依赖变化时清理
    return () => {
      setPreviewUrl((prevUrl) => {
        if (prevUrl && prevUrl.startsWith('blob:')) {
          URL.revokeObjectURL(prevUrl)
        }
        return null
      })
      setIframeLoadTimeout((timeout) => {
        if (timeout) {
          clearTimeout(timeout)
        }
        return null
      })
    }
  }, [visible, fileId])

  const renderDocx = useCallback(async () => {
    if (!fileId || !token || previewType !== 'docx') return
    try {
      setDocxLoading(true)
      const res = await fetch(`/api/files/preview/${fileId}?download=true`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('获取文件失败')
      const blob = await res.blob()
      // 等待 DOM 渲染出容器
      await new Promise(r => setTimeout(r, 200))
      if (docxContainerRef.current) {
        docxContainerRef.current.innerHTML = ''
        await renderAsync(blob, docxContainerRef.current, undefined, {
          className: 'docx-preview-wrapper',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false
        })
      }
    } catch (err: unknown) {
      console.error('docx-preview 渲染失败:', err)
      message.error('文档预览失败: ' + (err instanceof Error ? err.message : '未知错误'))
      setPreviewable(false)
      setPreviewError('文档预览渲染失败')
    } finally {
      setDocxLoading(false)
    }
  }, [fileId, token, previewType])

  useEffect(() => {
    if (visible && previewType === 'docx') {
      renderDocx()
    }
  }, [visible, previewType, renderDocx])

  const loadPreview = async () => {
    if (!fileId) return

    // 重置所有状态
    setPreviewUrl(null)
    setPreviewable(true) // 初始假设可以预览
    setPreviewError(null)
    setIsLocalhostEnv(false)
    setPreviewType(null)
    setTextContent(null)
    setLoading(true)
    try {
      const response = await fetch(`/api/files/preview/${fileId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || '加载预览失败')
      }

      const contentType = response.headers.get('content-type') || ''

      // 如果是JSON响应（可能是Office文档的预览信息）
      if (contentType.includes('application/json')) {
        const data = await response.json()
        if (data.success && data.data) {
          // 如果是Office文档，使用在线预览服务
          if (data.data.previewType === 'office') {
            const previewUrlVal = data.data.previewUrl || ''
            const isUnreachable = previewUrlVal.includes('localhost') ||
              previewUrlVal.includes('127.0.0.1') ||
              /https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(previewUrlVal) ||
              /https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}/.test(previewUrlVal) ||
              /https?:\/\/192\.168\.\d{1,3}\.\d{1,3}/.test(previewUrlVal)

            if (isUnreachable) {
              // .docx 文件：使用 docx-preview 本地渲染
              const currentFileExt = (fileName || data.data.fileName || '').toLowerCase().split('.').pop()
              if (currentFileExt === 'docx') {
                setPreviewType('docx')
                setPreviewUrl('docx')
                setPreviewable(true)
                setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
                setActualMimeType(data.data.mimeType || null)
                setLoading(false)
                return
              }

              // 其他 Office 文件（doc/xls/xlsx/ppt/pptx）：提示下载
              setPreviewUrl(null)
              setPreviewable(false)
              setIsLocalhostEnv(true)
              setPreviewError('本地/内网环境无法预览此 Office 文件')
              setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
              setActualMimeType(data.data.mimeType || null)
              setPreviewType('office')
              setLoading(false)

              Modal.warning({
                title: '无法预览 Office 文件',
                width: 600,
                icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
                content: (
                  <div style={{ lineHeight: 1.8 }}>
                    <p style={{ marginBottom: 12, fontSize: 14 }}>
                      <strong>原因：</strong>该格式暂不支持内网本地预览，仅 .docx 支持。其他 Office 格式需公网可达的在线预览服务。
                    </p>
                    <p style={{ marginBottom: 12, fontSize: 14 }}>
                      <strong>解决方案：</strong>
                    </p>
                    <ul style={{ marginLeft: 20, marginBottom: 12, fontSize: 14 }}>
                      <li>下载后使用本地 Office 软件打开</li>
                      <li>公网部署后可直接在线预览</li>
                    </ul>
                  </div>
                ),
                okText: '我知道了'
              })

              return
            } else {
              // 生产环境，优先使用 Microsoft Office Online Viewer
              if (data.data.officeViewerUrl) {
                setPreviewable(true)
                setPreviewUrl(data.data.officeViewerUrl)
                setActualMimeType(data.data.mimeType || null)
                setPreviewType('office')
                setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
              } else if (data.data.googleDocsViewerUrl) {
                setPreviewable(true)
                setPreviewUrl(data.data.googleDocsViewerUrl)
                setActualMimeType(data.data.mimeType || null)
                setPreviewType('office')
                setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
              } else {
                setPreviewable(false)
                setPreviewError('无法获取预览服务')
                setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
                message.warning('无法获取预览服务，请下载文件查看', 5)
              }
            }
          } else {
            setPreviewable(false)
            setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
            message.info(data.data.message || '该文件类型不支持在线预览')
          }
        } else {
          setPreviewable(false)
          message.error('预览失败：响应格式错误')
        }
        setLoading(false)
        return
      }

      // 从Content-Type中提取实际的mimeType
      let extractedMimeType = mimeType || null
      if (contentType) {
        extractedMimeType = contentType.split(';')[0].trim()
        setActualMimeType(extractedMimeType)
      } else {
        setActualMimeType(mimeType || null)
      }
      setDownloadUrl(`/api/files/download/${fileId}`)

      // 文本文件：直接获取文本内容展示（需在 blob 前处理，否则 body 已被消费）
      const textExts = ['txt', 'md', 'markdown', 'json', 'xml', 'html', 'htm', 'css', 'js', 'log', 'csv', 'ini', 'conf', 'yml', 'yaml']
      const extFromName = fileName?.toLowerCase().split('.').pop() || ''
      const isTextType = extractedMimeType?.startsWith('text/') ||
        extractedMimeType === 'application/json' ||
        extractedMimeType === 'application/xml' ||
        extractedMimeType === 'application/javascript' ||
        textExts.includes(extFromName)
      if (isTextType) {
        const text = await response.text()
        setPreviewType('text')
        setTextContent(text)
        setPreviewUrl('text')
        setPreviewable(true)
        setLoading(false)
        return
      }

      // 图片或PDF：使用 blob URL
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      if (extractedMimeType?.startsWith('image/')) {
        setPreviewType('image')
        setPreviewUrl(url)
        setPreviewable(true)
      } else if (extractedMimeType === 'application/pdf') {
        setPreviewType('pdf')
        setPreviewUrl(url)
        setPreviewable(true)
      } else {
        URL.revokeObjectURL(url)
        setPreviewUrl(null)
        setPreviewable(false)
        message.info('该文件类型不支持在线预览，请下载后查看')
      }
    } catch (error: unknown) {
      console.error('加载预览失败:', error)
      message.error(error instanceof Error ? error.message : '加载预览失败')
      setPreviewable(false)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!fileId) return
    if (!token) {
      message.error('未登录，请先登录')
      return
    }
    const hide = message.loading('正在准备下载，请稍候...', 0)
    try {
      const response = await fetch(`/api/files/download/${fileId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || '下载失败')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName || 'download'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      hide()
      message.success('下载成功')
    } catch (error: unknown) {
      console.error('下载失败:', error)
      hide()
      message.error(error instanceof Error ? error.message : '下载失败')
    }
  }

  const effectiveMimeType = actualMimeType || mimeType || ''
  const fileExt = fileName?.toLowerCase().split('.').pop() || ''

  const isImage = effectiveMimeType.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(fileExt)

  const isPdf = effectiveMimeType === 'application/pdf' || fileExt === 'pdf'

  const isOfficeWithViewer = previewType === 'office' && previewUrl && (
    previewUrl.includes('officeapps.live.com') || previewUrl.includes('docs.google.com')
  )

  return (
    <Modal
      title={fileName || '文件预览'}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="download" icon={<DownloadOutlined />} onClick={handleDownload}>
          下载
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>
      ]}
      width={isPdf || isOfficeWithViewer || previewType === 'text' || previewType === 'docx' ? '90%' : 'auto'}
      style={{ top: 20 }}
      styles={{
        body: {
          padding: 0,
          minHeight: '60vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#f5f5f5'
        }
      }}
    >
      {loading ? (
        <div style={{ padding: '100px', textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>加载中...</div>
        </div>
      ) : !previewable || !previewUrl ? (
        <div style={{ padding: '100px', textAlign: 'center' }}>
          {(() => {
            const isWordFile = fileName?.toLowerCase().endsWith('.doc') || fileName?.toLowerCase().endsWith('.docx')
            const shouldShowLocalhostError = (isLocalhostEnv && previewType === 'office') ||
              (isLocalhostEnv && isWordFile) ||
              (previewType === 'office' && previewError?.includes('本地'))

            if (shouldShowLocalhostError) {
              return (
                <>
                  <div style={{ marginBottom: 24, color: '#ff4d4f', fontSize: 16, fontWeight: 'bold' }}>
                    ⚠️ 本地/内网环境无法预览 Office 文件
                  </div>
                  <div style={{ marginBottom: 16, color: '#666', lineHeight: 1.8 }}>
                    <p style={{ marginBottom: 8 }}>该格式暂不支持内网本地预览（仅 .docx 支持），请下载后使用 Office 打开。</p>
                    <p style={{ marginBottom: 8 }}><strong>解决方案：</strong></p>
                    <ul style={{ textAlign: 'left', display: 'inline-block', marginTop: 8, marginBottom: 0 }}>
                      <li>公网部署：使用公网 IP 或域名</li>
                      <li>内网/本地：下载后使用 Office 打开，或使用 ngrok 等内网穿透</li>
                    </ul>
                  </div>
                </>
              )
            } else if (previewError) {
              return (
                <>
                  <div style={{ marginBottom: 24, color: '#ff4d4f', fontSize: 16, fontWeight: 'bold' }}>
                    ⚠️ {previewError}
                  </div>
                  <div style={{ marginBottom: 16, color: '#666' }}>
                    {previewType === 'office' && (
                      <p>Word 文件预览需要服务器是公网可访问的。如果服务器在本地或内网，请下载文件后使用本地 Office 软件打开。</p>
                    )}
                  </div>
                </>
              )
            } else {
              return <p style={{ marginBottom: 16, color: '#666' }}>该文件类型不支持在线预览</p>
            }
          })()}
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload} size="large">
            下载文件
          </Button>
        </div>
      ) : previewable && (previewUrl || textContent) ? (
        <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
          {previewType === 'docx' ? (
            <div style={{ width: '100%', minHeight: '60vh', maxHeight: '80vh', overflow: 'auto', position: 'relative' }}>
              {docxLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.8)', zIndex: 10 }}>
                  <Spin size="large" tip="正在渲染文档..." />
                </div>
              )}
              <div
                ref={docxContainerRef}
                style={{
                  width: '100%',
                  minHeight: '60vh',
                  backgroundColor: '#fff',
                  padding: 0
                }}
              />
            </div>
          ) : previewType === 'text' && textContent != null ? (
            <pre
              style={{
                margin: 0,
                padding: 24,
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Monaco, Consolas, monospace',
                fontSize: 14,
                lineHeight: 1.6,
                maxHeight: '80vh',
                overflow: 'auto',
                backgroundColor: '#fff',
                border: '1px solid #f0f0f0',
                borderRadius: 4
              }}
            >
              {textContent}
            </pre>
          ) : isImage ? (
            <img
              src={previewUrl}
              alt={fileName}
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                display: 'block',
                margin: '0 auto'
              }}
            />
          ) : isPdf || isOfficeWithViewer ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <iframe
                src={previewUrl}
                style={{
                  width: '100%',
                  height: '80vh',
                  border: 'none'
                }}
                title={fileName}
                allow="fullscreen"
                onError={() => {
                  if (iframeLoadTimeout) {
                    clearTimeout(iframeLoadTimeout)
                    setIframeLoadTimeout(null)
                  }
                  setPreviewable(false)
                  setPreviewError('预览加载失败，在线预览服务无法访问此文件')
                  message.error('预览加载失败，请尝试下载文件', 5)
                }}
                onLoad={() => {
                  const timeout = setTimeout(() => {
                    const iframe = document.querySelector(`iframe[title="${fileName}"]`) as HTMLIFrameElement
                    if (iframe) {
                      try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
                        if (iframeDoc?.body) {
                          const bodyText = iframeDoc.body.innerText || iframeDoc.body.textContent || ''
                          if (bodyText.includes('无法访问') ||
                              bodyText.includes('无法加载') ||
                              bodyText.includes('Access Denied') ||
                              bodyText.includes("This site can't be reached")) {
                            setPreviewable(false)
                            setPreviewError('在线预览服务无法访问此文件，请下载文件查看')
                            message.warning('预览加载失败，请下载文件查看', 5)
                          }
                        }
                      } catch {
                        // 跨域限制
                      }
                    }
                    setIframeLoadTimeout(null)
                  }, 5000)
                  setIframeLoadTimeout(timeout)
                }}
              />
            </div>
          ) : (
            <div style={{ padding: '100px', textAlign: 'center' }}>
              <p>不支持预览此文件类型</p>
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
                下载文件
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
