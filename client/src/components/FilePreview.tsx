import { useState, useEffect } from 'react'
import { Modal, Spin, message, Button } from 'antd'
import { DownloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
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
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [actualMimeType, setActualMimeType] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<string | null>(null) // 'image' | 'pdf' | 'office'
  const [previewError, setPreviewError] = useState<string | null>(null) // 预览错误信息
  const [isLocalhostEnv, setIsLocalhostEnv] = useState(false) // 是否是本地环境
  const [iframeLoadTimeout, setIframeLoadTimeout] = useState<NodeJS.Timeout | null>(null) // iframe 加载超时定时器
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

  const loadPreview = async () => {
    if (!fileId) return

    // 重置所有状态
    setPreviewUrl(null)
    setPreviewable(true) // 初始假设可以预览
    setPreviewError(null)
    setIsLocalhostEnv(false)
    setPreviewType(null)
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
        console.log('预览响应数据:', data)
        if (data.success && data.data) {
          // 如果是Office文档，使用在线预览服务
          if (data.data.previewType === 'office') {
            console.log('Office 文档预览')
            console.log('预览 URL:', data.data.previewUrl)
            console.log('Office Viewer URL:', data.data.officeViewerUrl)
            console.log('Google Docs Viewer URL:', data.data.googleDocsViewerUrl)
            
            // 检查预览 URL 是否是 localhost（在线预览服务无法访问 localhost）
            const previewUrl = data.data.previewUrl || ''
            const isLocalhost = previewUrl.includes('localhost') || previewUrl.includes('127.0.0.1')
            
            if (isLocalhost) {
              // 本地环境，在线预览服务无法访问 localhost
              console.warn('本地环境，在线预览服务无法访问 localhost')
              
              // 直接提示用户无法预览，需要下载
              setPreviewUrl(null) // 确保 previewUrl 为 null
              setPreviewable(false)
              setIsLocalhostEnv(true)
              setPreviewError('本地环境无法预览 Office 文件')
              setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
              setActualMimeType(data.data.mimeType || null)
              setPreviewType('office')
              setLoading(false) // 确保 loading 状态被设置为 false
              
              // 显示警告弹框
              Modal.warning({
                title: '无法预览 Word 文件',
                width: 600,
                icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
                content: (
                  <div style={{ lineHeight: 1.8 }}>
                    <p style={{ marginBottom: 12, fontSize: 14 }}>
                      <strong>原因：</strong>Word 文件预览需要服务器是公网可访问的，当前服务器部署在本地（localhost），在线预览服务无法访问。
                    </p>
                    <p style={{ marginBottom: 12, fontSize: 14 }}>
                      <strong>解决方案：</strong>
                    </p>
                    <ul style={{ marginLeft: 20, marginBottom: 12, fontSize: 14 }}>
                      <li>生产环境：使用公网 IP 或域名部署服务器</li>
                      <li>开发/测试环境：下载文件后使用本地 Office 软件打开</li>
                      <li>内网环境：可使用内网穿透工具（如 ngrok）临时提供公网访问</li>
                    </ul>
                    <p style={{ marginTop: 16, marginBottom: 0, fontSize: 14, color: '#666' }}>
                      点击"确定"后可以在预览窗口中下载文件。
                    </p>
                  </div>
                ),
                okText: '我知道了',
                onOk: () => {
                  // 弹框关闭后，预览窗口会显示下载按钮
                }
              })
              
              return // 提前返回，不继续执行
            } else {
              // 生产环境，优先使用 Microsoft Office Online Viewer
              if (data.data.officeViewerUrl) {
                console.log('使用 Microsoft Office Online Viewer')
                setPreviewable(true)
                setPreviewUrl(data.data.officeViewerUrl)
                setActualMimeType(data.data.mimeType || null)
                setPreviewType('office')
                setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
              } else if (data.data.googleDocsViewerUrl) {
                // 备选：使用 Google Docs Viewer
                console.log('使用 Google Docs Viewer')
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
            // 其他不支持预览的文件类型
            console.log('不支持预览的文件类型:', data.data)
            setPreviewable(false)
            setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
            message.info(data.data.message || '该文件类型不支持在线预览')
          }
        } else {
          console.error('预览响应格式错误:', data)
          setPreviewable(false)
          message.error('预览失败：响应格式错误')
        }
        setLoading(false)
        return
      }

      // 如果是图片或PDF，根据Content-Type判断
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
      setPreviewable(true)
      setDownloadUrl(`/api/files/download/${fileId}`)
      
      // 从Content-Type中提取实际的mimeType
      let extractedMimeType = mimeType || null
      if (contentType) {
        extractedMimeType = contentType.split(';')[0].trim()
        setActualMimeType(extractedMimeType)
      } else {
        setActualMimeType(mimeType || null)
      }
      
      // 设置预览类型
      if (extractedMimeType?.startsWith('image/')) {
        setPreviewType('image')
      } else if (extractedMimeType === 'application/pdf') {
        setPreviewType('pdf')
      }
    } catch (error: any) {
      console.error('加载预览失败:', error)
      message.error(error.message || '加载预览失败')
      setPreviewable(false)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!fileId) return
    
    try {
      if (!token) {
        message.error('未登录，请先登录')
        return
      }
      
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
      message.success('文件下载开始')
    } catch (error: any) {
      console.error('下载失败:', error)
      message.error(error.message || '下载失败')
    }
  }

  // 根据实际的mimeType或文件扩展名判断文件类型
  const effectiveMimeType = actualMimeType || mimeType || ''
  const fileExt = fileName?.toLowerCase().split('.').pop() || ''
  
  // 判断是否为图片
  const isImage = effectiveMimeType.startsWith('image/') || 
    ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(fileExt)
  
  // 判断是否为PDF
  const isPdf = effectiveMimeType === 'application/pdf' || fileExt === 'pdf'
  
  // 判断是否为Office文档（通过预览类型或预览URL判断）
  const isOffice = previewType === 'office' || (previewUrl && (
    previewUrl.includes('officeapps.live.com') || 
    previewUrl.includes('docs.google.com') ||
    effectiveMimeType.includes('word') ||
    effectiveMimeType.includes('excel') ||
    effectiveMimeType.includes('powerpoint') ||
    effectiveMimeType.includes('spreadsheet') ||
    effectiveMimeType.includes('presentation') ||
    effectiveMimeType.includes('msword') ||
    effectiveMimeType.includes('ms-excel') ||
    effectiveMimeType.includes('ms-powerpoint') ||
    ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(fileExt)
  ))

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
      width={isPdf || isOffice ? '90%' : 'auto'}
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
        // 无法预览的情况
        <div style={{ padding: '100px', textAlign: 'center' }}>
          {(() => {
            // 调试信息
            console.log('渲染无法预览界面:', {
              isLocalhostEnv,
              previewType,
              previewError,
              previewable,
              previewUrl,
              fileName,
              fileExt: fileName?.toLowerCase().split('.').pop()
            })
            
            // 判断是否是 Word 文件且是 localhost 环境
            const isWordFile = fileName?.toLowerCase().endsWith('.doc') || fileName?.toLowerCase().endsWith('.docx')
            const shouldShowLocalhostError = (isLocalhostEnv && previewType === 'office') || 
                                            (isLocalhostEnv && isWordFile) ||
                                            (previewType === 'office' && previewError && previewError.includes('本地环境'))
            
            if (shouldShowLocalhostError) {
              return (
                <>
                  <div style={{ marginBottom: 24, color: '#ff4d4f', fontSize: 16, fontWeight: 'bold' }}>
                    ⚠️ 本地环境无法预览 Office 文件
                  </div>
                  <div style={{ marginBottom: 16, color: '#666', lineHeight: 1.8 }}>
                    <p style={{ marginBottom: 8 }}>Word 文件预览需要服务器是公网可访问的。</p>
                    <p style={{ marginBottom: 8 }}><strong>当前环境：</strong>服务器部署在本地（localhost）</p>
                    <p style={{ marginBottom: 8 }}><strong>解决方案：</strong></p>
                    <ul style={{ textAlign: 'left', display: 'inline-block', marginTop: 8, marginBottom: 0 }}>
                      <li>生产环境：使用公网 IP 或域名部署服务器</li>
                      <li>开发/测试环境：下载文件后使用本地 Office 软件打开</li>
                      <li>内网环境：可使用内网穿透工具（如 ngrok）临时提供公网访问</li>
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
      ) : previewable && previewUrl ? (
        <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
          {isImage ? (
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
          ) : isPdf || isOffice ? (
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
                onError={(e) => {
                  console.error('iframe 加载失败:', e)
                  if (iframeLoadTimeout) {
                    clearTimeout(iframeLoadTimeout)
                    setIframeLoadTimeout(null)
                  }
                  setPreviewable(false)
                  setPreviewError('预览加载失败，在线预览服务无法访问此文件')
                  message.error('预览加载失败，请尝试下载文件', 5)
                }}
                onLoad={() => {
                  console.log('iframe onLoad 事件触发')
                  // 设置超时检测，如果 5 秒后 iframe 仍然无法正常显示，认为加载失败
                  const timeout = setTimeout(() => {
                    const iframe = document.querySelector('iframe[title="' + fileName + '"]') as HTMLIFrameElement
                    if (iframe) {
                      try {
                        // 尝试访问 iframe 内容
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
                        if (!iframeDoc) {
                          // 无法访问文档，可能是跨域或加载失败
                          console.warn('无法访问 iframe 内容，可能加载失败')
                          // 不设置错误，因为可能是跨域限制导致的正常情况
                        } else {
                          // 检查是否有错误信息
                          const bodyText = iframeDoc.body?.innerText || iframeDoc.body?.textContent || ''
                          if (bodyText.includes('无法访问') || 
                              bodyText.includes('无法加载') || 
                              bodyText.includes('Access Denied') ||
                              bodyText.includes('This site can\'t be reached')) {
                            setPreviewable(false)
                            setPreviewError('在线预览服务无法访问此文件，请下载文件查看')
                            message.warning('预览加载失败，请下载文件查看', 5)
                          }
                        }
                      } catch (e) {
                        // 跨域限制，无法检查内容
                        console.log('无法检查 iframe 内容（跨域限制）')
                        // 不设置错误，因为跨域限制是正常情况
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

