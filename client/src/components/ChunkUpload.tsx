import { useState } from 'react'
import { Upload, Progress, Button, message } from 'antd'
import { PauseOutlined, PlayCircleOutlined, CloseOutlined, UploadOutlined } from '@ant-design/icons'
import api from '../services/api'
import { useAuthStore } from '../stores/authStore'

interface ChunkUploadProps {
  onSuccess?: (fileId: number, fileName: string) => void
  folderId?: number
  spaceId?: number
  chunkSize?: number // 分块大小，默认5MB
}

export default function ChunkUpload({ onSuccess, folderId, spaceId, chunkSize = 5 * 1024 * 1024 }: ChunkUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  // const uploadControllerRef = useRef<AbortController | null>(null) // 暂时未使用
  const { token } = useAuthStore()

  // 将文件分割成块
  const splitFile = (file: File, chunkSize: number): Blob[] => {
    const chunks: Blob[] = []
    let start = 0
    while (start < file.size) {
      chunks.push(file.slice(start, start + chunkSize))
      start += chunkSize
    }
    return chunks
  }

  // 初始化上传
  const initUpload = async (file: File) => {
    const totalChunks = Math.ceil(file.size / chunkSize)
    
    try {
      const response = await api.post('/files/upload/init', {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        totalChunks,
        chunkSize,
        folderId,
        spaceId
      })

      if (response.data.success) {
        return response.data.data.uploadId
      } else {
        throw new Error(response.data.message || '初始化上传失败')
      }
    } catch (error: any) {
      console.error('初始化上传失败:', error)
      message.error(error.response?.data?.message || '初始化上传失败')
      throw error
    }
  }

  // 上传单个分块
  const uploadChunk = async (uploadId: string, chunkIndex: number, chunk: Blob): Promise<boolean> => {
    const formData = new FormData()
    formData.append('chunk', chunk)
    formData.append('uploadId', uploadId)
    formData.append('chunkIndex', chunkIndex.toString())

    try {
      const response = await api.post('/files/upload/chunk', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${token}`
        }
      })

      return response.data.success
    } catch (error: any) {
      console.error(`上传分块 ${chunkIndex} 失败:`, error)
      return false
    }
  }

  // 查询上传状态
  const checkUploadStatus = async (uploadId: string) => {
    try {
      const response = await api.get(`/files/upload/status/${uploadId}`)
      if (response.data.success) {
        return response.data.data
      }
      return null
    } catch (error) {
      console.error('查询上传状态失败:', error)
      return null
    }
  }

  // 完成上传
  const completeUpload = async (uploadId: string) => {
    try {
      const response = await api.post('/files/upload/complete', { uploadId })
      if (response.data.success) {
        return response.data.data
      } else {
        throw new Error(response.data.message || '完成上传失败')
      }
    } catch (error: any) {
      console.error('完成上传失败:', error)
      message.error(error.response?.data?.message || '完成上传失败')
      throw error
    }
  }

  // 取消上传
  const cancelUpload = async (uploadId: string) => {
    try {
      await api.post('/files/upload/cancel', { uploadId })
    } catch (error) {
      console.error('取消上传失败:', error)
    }
  }

  // 处理文件上传
  const handleUpload = async (file: File) => {
    setUploading(true)
    setPaused(false)
    setProgress(0)
    setFileName(file.name)

    let currentUploadId = uploadId

    try {
      // 如果没有uploadId，先初始化
      if (!currentUploadId) {
        currentUploadId = await initUpload(file)
        setUploadId(currentUploadId)
      }

      // 检查已上传的分块
      if (!currentUploadId) {
        throw new Error('上传ID不存在')
      }
      const status = await checkUploadStatus(currentUploadId)
      if (status && status.status === 'completed') {
        message.success('文件已上传完成')
        if (onSuccess && status.fileId) {
          onSuccess(status.fileId, status.fileName)
        }
        setUploading(false)
        return
      }

      const uploadedChunks = status?.uploadedChunkIndices || []
      const chunks = splitFile(file, chunkSize)
      const totalChunks = chunks.length

      // 上传未完成的分块
      for (let i = 0; i < totalChunks; i++) {
        // 如果已暂停，等待恢复
        while (paused && uploading) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // 如果已取消，退出
        if (!uploading) {
          break
        }

        // 如果分块已上传，跳过
        if (uploadedChunks.includes(i)) {
          const currentProgress = Math.round(((i + 1) / totalChunks) * 100)
          setProgress(currentProgress)
          continue
        }

        // 上传分块
        if (!currentUploadId) {
          throw new Error('上传ID不存在')
        }
        const success = await uploadChunk(currentUploadId, i, chunks[i])
        if (!success) {
          message.error(`分块 ${i + 1}/${totalChunks} 上传失败，请重试`)
          setUploading(false)
          return
        }

        // 更新进度
        const currentProgress = Math.round(((i + 1) / totalChunks) * 100)
        setProgress(currentProgress)
      }

      // 所有分块上传完成，合并文件
      if (uploading && !paused && currentUploadId) {
        message.loading({ content: '正在合并文件...', key: 'merging', duration: 0 })
        const result = await completeUpload(currentUploadId)
        message.destroy('merging')
        message.success('文件上传成功')
        
        if (onSuccess) {
          onSuccess(result.fileId, result.fileName)
        }

        // 重置状态
        setUploadId(null)
        setUploading(false)
        setProgress(0)
      }
    } catch (error: any) {
      console.error('上传失败:', error)
      message.error(error.message || '上传失败')
      setUploading(false)
    }
  }

  // 暂停上传
  const handlePause = () => {
    setPaused(true)
    message.info('上传已暂停')
  }

  // 恢复上传
  const handleResume = () => {
    setPaused(false)
    message.info('上传已恢复')
  }

  // 取消上传
  const handleCancel = async () => {
    if (uploadId) {
      await cancelUpload(uploadId)
    }
    setUploading(false)
    setPaused(false)
    setProgress(0)
    setUploadId(null)
    message.info('上传已取消')
  }

  const uploadProps = {
    customRequest: async (options: any) => {
      const { file, onSuccess: onUploadSuccess, onError } = options
      try {
        await handleUpload(file as File)
        onUploadSuccess?.('ok')
      } catch (error) {
        onError?.(error)
      }
    },
    showUploadList: false,
    beforeUpload: (file: File) => {
      const isLt10GB = file.size / 1024 / 1024 / 1024 < 10
      if (!isLt10GB) {
        message.error('文件大小不能超过10GB')
        return false
      }
      return true
    }
  }

  return (
    <div>
      <Upload {...uploadProps}>
        <Button icon={<UploadOutlined />} disabled={uploading}>
          选择文件
        </Button>
      </Upload>

      {uploading && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <span>{fileName}</span>
            <div style={{ float: 'right' }}>
              {paused ? (
                <Button
                  type="link"
                  icon={<PlayCircleOutlined />}
                  onClick={handleResume}
                  size="small"
                >
                  继续
                </Button>
              ) : (
                <Button
                  type="link"
                  icon={<PauseOutlined />}
                  onClick={handlePause}
                  size="small"
                >
                  暂停
                </Button>
              )}
              <Button
                type="link"
                icon={<CloseOutlined />}
                onClick={handleCancel}
                size="small"
                danger
              >
                取消
              </Button>
            </div>
          </div>
          <Progress percent={progress} status={paused ? 'active' : 'active'} />
        </div>
      )}
    </div>
  )
}

