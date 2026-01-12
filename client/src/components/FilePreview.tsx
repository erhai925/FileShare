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
      
      // 如果是JSON响应（不支持预览的文件类型）
      if (contentType.includes('application/json')) {
        const data = await response.json()
        if (data.success && data.data) {
          setPreviewable(false)
          setDownloadUrl(data.data.downloadUrl || `/api/files/download/${fileId}`)
          message.info(data.data.message || '该文件类型不支持在线预览')
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
      if (contentType) {
        const extractedMimeType = contentType.split(';')[0].trim()
        setActualMimeType(extractedMimeType)
      } else {
        setActualMimeType(mimeType || null)
      }
    } catch (error: any) {
      console.error('加载预览失败:', error)
      message.error(error.message || '加载预览失败')
      setPreviewable(false)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank')
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
      width={isPdf ? '90%' : 'auto'}
      style={{ top: 20 }}
      bodyStyle={{ 
        padding: 0, 
        minHeight: '60vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5'
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
          ) : isPdf ? (
            <iframe
              src={previewUrl}
              style={{
                width: '100%',
                height: '80vh',
                border: 'none'
              }}
              title={fileName}
            />
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

