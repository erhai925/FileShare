import { useState, useEffect } from 'react'
import { Modal, Spin, message, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
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
  const { token } = useAuthStore()

  useEffect(() => {
    if (visible && fileId) {
      loadPreview()
    } else {
      // 清理预览URL
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
      setPreviewUrl(null)
      setDownloadUrl(null)
      setActualMimeType(null)
      setPreviewType(null)
    }
  }, [visible, fileId])

  const loadPreview = async () => {
    if (!fileId) return

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
          if (data.data.previewType === 'office' && data.data.officeViewerUrl) {
            console.log('使用 Office 预览 URL:', data.data.officeViewerUrl)
            console.log('预览 URL:', data.data.previewUrl)
            
            // 检查预览 URL 是否是 localhost（在线预览服务无法访问 localhost）
            const previewUrl = data.data.previewUrl || ''
            const isLocalhost = previewUrl.includes('localhost') || previewUrl.includes('127.0.0.1')
            
            if (isLocalhost) {
              // 本地环境，尝试直接下载文件并在浏览器中打开
              console.warn('本地环境，无法使用在线预览服务，尝试直接预览文件')
              // 使用预览 URL 直接加载文件
              try {
                const fileResponse = await fetch(data.data.previewUrl, {
                  headers: {
                    'Accept': data.data.mimeType || 'application/octet-stream'
                  }
                })
                if (fileResponse.ok) {
                  const blob = await fileResponse.blob()
                  const blobUrl = URL.createObjectURL(blob)
                  setPreviewable(true)
                  setPreviewUrl(blobUrl)
                  setActualMimeType(data.data.mimeType || null)
                  setPreviewType('office')
                  setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
                } else {
                  throw new Error('无法加载文件')
                }
              } catch (error) {
                console.error('直接预览失败:', error)
                // 如果直接预览失败，提示用户下载
                setPreviewable(false)
                setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
                message.warning('本地环境无法预览 Office 文件，请下载后查看')
              }
            } else {
              // 生产环境，使用在线预览服务
              setPreviewable(true)
              setPreviewUrl(data.data.officeViewerUrl)
              setActualMimeType(data.data.mimeType || null)
              setPreviewType('office')
              setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
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
            previewType === 'office' && previewUrl && previewUrl.startsWith('blob:') ? (
              // 本地环境，使用 embed 标签尝试预览
              <embed
                src={previewUrl}
                type={actualMimeType || 'application/msword'}
                style={{
                  width: '100%',
                  height: '80vh',
                  border: 'none'
                }}
              />
            ) : (
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
                  message.error('预览加载失败，请尝试下载文件')
                }}
              />
            )
          ) : (
            <div style={{ padding: '100px', textAlign: 'center' }}>
              <p>不支持预览此文件类型</p>
              <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
                下载文件
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '100px', textAlign: 'center' }}>
          <p>该文件类型不支持在线预览</p>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
            下载文件
          </Button>
        </div>
      )}
    </Modal>
  )
}

