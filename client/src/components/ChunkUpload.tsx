import { useState, useRef, useEffect } from 'react'
import { App, Upload, Progress, Button, message as antdMessage } from 'antd'
import type { MessageInstance } from 'antd/es/message/interface'
import { PauseOutlined, PlayCircleOutlined, CloseOutlined, UploadOutlined } from '@ant-design/icons'
import api from '../services/api'

/** 接口返回为 response.data（axios 拦截器已剥掉一层），此处按后端 body 类型使用 */
type ApiBody = { success?: boolean; data?: Record<string, unknown>; message?: string }

/** 上传状态接口返回的 data */
interface UploadStatusData {
  status?: string
  fileId?: number
  fileName?: string
  uploadedChunkIndices?: number[]
}
/** 完成上传接口返回的 data */
interface CompleteUploadData {
  fileId: number
  fileName: string
  fileSize?: number
  /** 同目录已存在内容相同的文件时由服务端回带；分块上传字节已传完，故只提示不阻拦 */
  duplicateOf?: { fileId: number; name: string } | null
}

interface ChunkUploadProps {
  onSuccess?: (fileId: number, fileName: string) => void
  folderId?: number
  spaceId?: number
  chunkSize?: number // 分块大小，默认5MB
  /** 由父组件传入可避免 Modal 内 useApp() 取不到 context 导致无响应 */
  messageApi?: MessageInstance
  /** 从普通上传切到大文件上传时传入已选文件，无需用户再次选择 */
  initialFile?: File | null
  /** 已消费 initialFile 时回调，便于父组件清空 */
  onInitialFileConsumed?: () => void
}

export default function ChunkUpload({ onSuccess, folderId, spaceId, chunkSize = 5 * 1024 * 1024, messageApi, initialFile, onInitialFileConsumed }: ChunkUploadProps) {
  let message: MessageInstance
  try {
    message = messageApi ?? App.useApp().message
  } catch {
    message = antdMessage
  }
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [statusText, setStatusText] = useState<string>('')
  /** 异步 handleUpload 内用 ref 读取当前状态，避免闭包拿到旧的 uploading/paused 导致循环直接退出 */
  const uploadingRef = useRef(false)
  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = paused }, [paused])

  // 从普通上传切过来时自动开始上传已选文件，无需用户再选一次
  useEffect(() => {
    if (!initialFile || uploadingRef.current) return
    const file = initialFile
    onInitialFileConsumed?.()
    handleUpload(file).catch(() => {})
  }, [initialFile])

  // 按索引取第 i 块（避免大文件一次性 slice 全部分块阻塞主线程）
  const getChunk = (file: File, chunkSize: number, index: number): Blob => {
    const start = index * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    return file.slice(start, end)
  }

  // 初始化上传
  const initUpload = async (file: File) => {
    const totalChunks = Math.ceil(file.size / chunkSize)
    
    try {
      const response = (await api.post('/files/upload/init', {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        totalChunks,
        chunkSize,
        folderId,
        spaceId
      })) as ApiBody

      if (response?.success && response?.data?.uploadId) {
        return response.data.uploadId as string
      }
      throw new Error(response?.message || '初始化上传失败')
    } catch (error: any) {
      console.error('初始化上传失败:', error)
      message.error(error?.message || '初始化上传失败')
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
      const response = (await api.post('/files/upload/chunk', formData)) as ApiBody
      return response?.success === true
    } catch (error: any) {
      console.error(`上传分块 ${chunkIndex} 失败:`, error)
      return false
    }
  }

  // 查询上传状态
  const checkUploadStatus = async (uploadId: string): Promise<UploadStatusData | null> => {
    try {
      const response = (await api.get(`/files/upload/status/${uploadId}`)) as ApiBody
      if (response?.success && response?.data) {
        return response.data as UploadStatusData
      }
      return null
    } catch (error) {
      console.error('查询上传状态失败:', error)
      return null
    }
  }

  // 完成上传（合并分块可能耗时较长，大文件需 3 分钟超时）
  const completeUpload = async (uploadId: string): Promise<CompleteUploadData> => {
    try {
      const response = (await api.post('/files/upload/complete', { uploadId }, { timeout: 180000 })) as ApiBody
      if (response?.success && response?.data) {
        return response.data as unknown as CompleteUploadData
      }
      throw new Error(response?.message || '完成上传失败')
    } catch (error: any) {
      console.error('完成上传失败:', error)
      message.error(error?.message || '完成上传失败')
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
    uploadingRef.current = true
    setUploading(true)
    setPaused(false)
    pausedRef.current = false
    setProgress(0)
    setFileName(file.name)
    setStatusText('正在初始化上传…')
    // 让 React 先渲染“上传中”界面，再发起请求，避免选择文件后长时间无视觉反馈
    await new Promise(r => setTimeout(r, 0))

    let currentUploadId = uploadId

    try {
      // 如果没有uploadId，先初始化
      if (!currentUploadId) {
        try {
          currentUploadId = await initUpload(file)
          setUploadId(currentUploadId)
        } finally {
          setStatusText('')
        }
        // init 成功后让 UI 先渲染再继续，避免“无响应”感
        await new Promise(r => setTimeout(r, 0))
      }

      // 检查已上传的分块
      if (!currentUploadId) {
        throw new Error('上传ID不存在')
      }
      const status = await checkUploadStatus(currentUploadId)
      if (status && status.status === 'completed') {
        message.success('文件已上传完成')
        if (onSuccess && status.fileId != null) {
          onSuccess(status.fileId, status.fileName ?? '')
        }
        uploadingRef.current = false
        setUploading(false)
        return
      }

      const uploadedChunks = status?.uploadedChunkIndices || []
      const totalChunks = Math.ceil(file.size / chunkSize)

      // 让 UI 先更新（进度条、文案），再开始分块上传
      setProgress(1)
      await new Promise(r => setTimeout(r, 0))

      // 上传未完成的分块（按需取块，避免大文件一次性 slice 阻塞）
      for (let i = 0; i < totalChunks; i++) {
        // 如果已暂停，等待恢复
        while (pausedRef.current && uploadingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        // 如果已取消，退出
        if (!uploadingRef.current) {
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
        const success = await uploadChunk(currentUploadId, i, getChunk(file, chunkSize, i))
        if (!success) {
          message.error(`分块 ${i + 1}/${totalChunks} 上传失败，请重试`)
          uploadingRef.current = false
          setUploading(false)
          return
        }

        // 更新进度
        const currentProgress = Math.round(((i + 1) / totalChunks) * 100)
        setProgress(currentProgress)
      }

      // 所有分块上传完成，合并文件
      if (uploadingRef.current && !pausedRef.current && currentUploadId) {
        setProgress(100)
        setStatusText('正在合并文件…')
        const result = await completeUpload(currentUploadId)
        setStatusText('')
        message.success('文件上传成功')
        // 内容重复只提示不阻拦：字节已全部传完，退回重传毫无意义，由用户决定是否删除
        if (result.duplicateOf) {
          message.warning(
            `注意：当前目录已存在内容相同的文件「${result.duplicateOf.name}」，如不需要可自行删除本次上传的副本`,
            8
          )
        }

        if (onSuccess) {
          onSuccess(result.fileId, result.fileName)
        }

        // 重置状态
        setUploadId(null)
        uploadingRef.current = false
        setUploading(false)
        setProgress(0)
      }
    } catch (error: any) {
      console.error('上传失败:', error)
      message.error(error?.message || '上传失败')
      uploadingRef.current = false
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
    uploadingRef.current = false
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
      const raw = options?.file
      const file = (raw?.originFileObj ?? raw) as File | undefined
      const onUploadSuccess = options?.onSuccess
      const onError = options?.onError
      if (!file || !(file instanceof File)) {
        onError?.(new Error('未获取到文件'))
        return
      }
      try {
        await handleUpload(file)
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
            {statusText && <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>{statusText}</span>}
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

