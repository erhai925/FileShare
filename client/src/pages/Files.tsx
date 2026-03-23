import { useState, useEffect } from 'react'
import { App, Table, Button, Upload, Space, Input, message, Modal, Form, Select, Popconfirm } from 'antd'
import { UploadOutlined, SearchOutlined, FolderOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'
import FilePreview from '../components/FilePreview'
import FileActions from '../components/FileActions'
import ChunkUpload from '../components/ChunkUpload'
import { formatDateTime } from '../utils/date'
import type { UploadProps } from 'antd'

const { Option } = Select
/** 根目录在 Select 中用空字符串表示，避免 antd 的 value 不能为 null 的警告 */
const ROOT_FOLDER_VALUE = ''
/** 超过该大小（50MB）时提示用户考虑使用大文件上传 */
const LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024

// File System Access API 类型定义
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableStream>
}

interface FileSystemWritableStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface WindowWithFileSystem extends Window {
  showSaveFilePicker?(options: {
    suggestedName?: string
    types?: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }): Promise<FileSystemFileHandle>
}

export default function Files() {
  const { message: messageApi } = App.useApp()
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [moveModalVisible, setMoveModalVisible] = useState(false)
  const [selectedFile, setSelectedFile] = useState<any>(null)
  const [moveForm] = Form.useForm()
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewFileId, setPreviewFileId] = useState<number | null>(null)
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [renameForm] = Form.useForm()
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [chunkUploadVisible, setChunkUploadVisible] = useState(false)
  const [chunkUploadPendingFile, setChunkUploadPendingFile] = useState<File | null>(null)
  const [uploadSpaceId, setUploadSpaceId] = useState<number | undefined>(undefined)
  const [uploadFolderId, setUploadFolderId] = useState<number | undefined>(undefined)
  const [chunkUploadSpaceId, setChunkUploadSpaceId] = useState<number | undefined>(undefined)
  const [chunkUploadFolderId, setChunkUploadFolderId] = useState<number | undefined>(undefined)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { token } = useAuthStore()
  
  // 防抖处理：延迟500ms更新搜索关键词
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchKeyword)
      setCurrentPage(1) // 搜索时重置到第一页
    }, 500)
    
    return () => clearTimeout(timer)
  }, [searchKeyword])
  
  // 获取空间列表（用于移动文件）
  const { data: spacesData } = useQuery({
    queryKey: ['spaces'],
    queryFn: () => api.get('/spaces')
  })

  // 获取选中空间的文件夹列表（用于移动文件）
  const selectedSpaceId = Form.useWatch('spaceId', moveForm)
  const { data: foldersData } = useQuery({
    queryKey: ['space-folders', selectedSpaceId],
    queryFn: () => api.get(`/spaces/${selectedSpaceId}/folders`),
    enabled: !!selectedSpaceId
  })

  // 上传目标：普通上传用空间的文件夹列表
  const { data: uploadFoldersData } = useQuery({
    queryKey: ['space-folders', uploadSpaceId],
    queryFn: () => api.get(`/spaces/${uploadSpaceId}/folders`),
    enabled: !!uploadSpaceId
  })

  // 大文件上传弹窗内用空间的文件夹列表
  const { data: chunkUploadFoldersData } = useQuery({
    queryKey: ['space-folders', chunkUploadSpaceId],
    queryFn: () => api.get(`/spaces/${chunkUploadSpaceId}/folders`),
    enabled: !!chunkUploadSpaceId
  })

  const { data, isLoading } = useQuery({
    queryKey: ['files', currentPage, pageSize, debouncedKeyword],
    queryFn: () => api.get('/files/list', {
      params: { page: currentPage, pageSize, keyword: debouncedKeyword || undefined }
    })
  })

  // 下载文件（支持选择保存路径）
  const handleDownload = async (fileId: number, fileName: string) => {
    const hide = messageApi.loading('正在准备下载，请稍候...', 0)
    try {
      const response = await fetch(`/api/files/download/${fileId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json()
        hide()
        messageApi.error(error.message || '下载失败')
        return
      }

      // 获取文件blob
      const blob = await response.blob()
      
      // 检查是否支持 File System Access API（现代浏览器）
      const win = window as WindowWithFileSystem
      if (win.showSaveFilePicker) {
        try {
          // 使用 File System Access API 让用户选择保存位置
          const fileHandle = await win.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: '文件',
              accept: {
                'application/octet-stream': ['.*']
              }
            }]
          })
          
          // 写入文件
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          
          hide()
          messageApi.success('文件保存成功')
        } catch (saveError: any) {
          // 用户取消选择，不显示错误
          if (saveError.name !== 'AbortError' && saveError.name !== 'NotAllowedError') {
            console.error('保存文件失败:', saveError)
            hide()
            downloadWithFallback(blob, fileName)
          } else {
            hide()
          }
        }
      } else {
        hide()
        downloadWithFallback(blob, fileName)
      }
    } catch (error: any) {
      console.error('下载错误:', error)
      hide()
      messageApi.error(error.message || '下载失败')
    }
  }

  // 传统下载方式（回退方案，调用时 loading 已由调用方关闭）
  const downloadWithFallback = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    messageApi.success('文件下载成功（已保存到浏览器默认下载文件夹）')
  }

  // 删除文件
  const handleDelete = async (fileId: number) => {
    try {
      await api.delete(`/files/${fileId}`)
      message.success('文件已移至回收站')
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.response?.data?.message || error.message || '删除失败')
    }
  }

  // 移动文件到空间（单个）
  const handleMoveFile = (file: any) => {
    setSelectedFile(file)
    setMoveModalVisible(true)
    moveForm.setFieldsValue({
      spaceId: file.space_id || undefined,
      folderId: file.folder_id || undefined
    })
  }

  // 批量移动：打开弹窗时用当前选中行
  const handleBatchMove = () => {
    if (selectedRowKeys.length === 0) return
    setSelectedFile(null)
    setMoveModalVisible(true)
    moveForm.setFieldsValue({ spaceId: undefined, folderId: undefined })
  }

  const handleMoveConfirm = async (values: any) => {
    const isBatch = selectedRowKeys.length > 0
    const idsToMove: number[] = isBatch ? (selectedRowKeys as number[]) : (selectedFile ? [selectedFile.id] : [])

    if (idsToMove.length === 0) return
    const payload = { ...values, folderId: values.folderId === ROOT_FOLDER_VALUE || values.folderId === undefined ? null : values.folderId }
    try {
      let success = 0
      let fail = 0
      for (const id of idsToMove) {
        try {
          await api.patch(`/files/${id}/move`, payload)
          success += 1
        } catch {
          fail += 1
        }
      }
      if (fail === 0) {
        message.success(isBatch ? `已成功移动 ${success} 个文件` : '文件移动成功')
      } else {
        message.warning(`移动完成：成功 ${success} 个，失败 ${fail} 个`)
      }
      setMoveModalVisible(false)
      setSelectedFile(null)
      setSelectedRowKeys([])
      moveForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.message || '移动失败')
    }
  }

  // 批量删除（移至回收站）
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    const ids = selectedRowKeys as number[]
    try {
      let success = 0
      let fail = 0
      for (const id of ids) {
        try {
          await api.delete(`/files/${id}`)
          success += 1
        } catch {
          fail += 1
        }
      }
      if (fail === 0) {
        message.success(`已将 ${success} 个文件移至回收站`)
      } else {
        message.warning(`删除完成：成功 ${success} 个，失败 ${fail} 个`)
      }
      setSelectedRowKeys([])
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.message || '批量删除失败')
    }
  }

  // 从空间移除文件
  const handleRemoveFromSpace = async (fileId: number) => {
    try {
      await api.patch(`/files/${fileId}/remove-from-space`)
      message.success('文件已从空间移除')
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.message || '移除失败')
    }
  }

  // 重命名文件
  const handleRename = (file: any) => {
    setSelectedFile(file)
    renameForm.setFieldsValue({ newName: file.original_name })
    setRenameModalVisible(true)
  }

  const handleRenameConfirm = async (values: any) => {
    if (!selectedFile) return
    try {
      await api.patch(`/files/${selectedFile.id}/rename`, { newName: values.newName })
      message.success('文件重命名成功')
      setRenameModalVisible(false)
      setSelectedFile(null)
      renameForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.message || '重命名失败')
    }
  }

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: true,
    customRequest: async ({ file, onSuccess, onError }) => {
      const formData = new FormData()
      formData.append('file', file as File)
      formData.append('spaceId', String(uploadSpaceId ?? ''))
      formData.append('folderId', String(uploadFolderId ?? ''))
      try {
        const res = await api.post('/files/upload', formData, { timeout: 300000 })
        const data = res as any
        if (data?.success) {
          onSuccess?.(data)
        } else {
          onError?.(new Error(data?.message || '上传失败'))
        }
      } catch (err: any) {
        const msg = typeof err === 'string' ? err : (err?.message || err?.response?.data?.message || '上传失败')
        const hint = err?.hint || err?.response?.data?.hint
        const detail = err?.error || err?.response?.data?.error
        const detailStr = typeof detail === 'object' ? detail?.message || JSON.stringify(detail) : String(detail)
        let fullMsg = msg
        if (hint) fullMsg += `；${hint}`
        if (detailStr) fullMsg += `（${detailStr}）`
        onError?.(new Error(fullMsg))
      }
    },
    onChange(info) {
      if (info.file.status === 'done') {
        const response = info.file.response
        if (response?.success) {
          message.success(response.message || `${info.file.name} 上传成功`)
          queryClient.invalidateQueries({ queryKey: ['files'] })
        } else {
          message.error(response?.message || `${info.file.name} 上传失败`)
        }
      } else if (info.file.status === 'error') {
        const error = info.file.error
        const errorMsg = error?.message || `${info.file.name} 上传失败`
        message.error(errorMsg)
        if (info.file.size && info.file.size > 50 * 1024 * 1024) {
          message.info('大文件建议使用「大文件上传（断点续传）」')
        }
      }
    },
    beforeUpload: (file) => {
      const isLt10GB = file.size / 1024 / 1024 / 1024 < 10
      if (!isLt10GB) {
        message.error('文件大小不能超过10GB，请使用「大文件上传」')
        return false
      }
      if (file.size >= LARGE_FILE_THRESHOLD_BYTES) {
        return new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '选择上传方式',
            content: `当前文件约 ${(file.size / 1024 / 1024).toFixed(1)} MB，建议使用「大文件上传」以获得断点续传。是否仍使用普通上传？`,
            okText: '仍使用普通上传',
            cancelText: '使用大文件上传',
            onOk: () => resolve(true),
            onCancel: () => {
              setChunkUploadPendingFile(file)
              setChunkUploadSpaceId(uploadSpaceId)
              setChunkUploadFolderId(uploadFolderId ?? undefined)
              setChunkUploadVisible(true)
              resolve(false)
            }
          })
        })
      }
      return true
    }
  }

  const columns = [
    {
      title: '文件名',
      dataIndex: 'original_name',
      key: 'original_name',
      render: (text: string, record: any) => (
        <a
          href={`/files/${record.id}`}
          onClick={(e) => {
            e.preventDefault()
            navigate(`/files/${record.id}`)
          }}
        >
          {text}
        </a>
      )
    },
    {
      title: '所属空间',
      dataIndex: 'space_name',
      key: 'space_name',
      render: (name: string) => name || <span style={{ color: 'var(--text-muted)' }}>未分类</span>
    },
    {
      title: '所在文件夹',
      dataIndex: 'folder_name',
      key: 'folder_name',
      render: (name: string, record: any) =>
        record.folder_id ? (name || <span style={{ color: 'var(--text-muted)' }}>已删除</span>) : <span style={{ color: 'var(--text-muted)' }}>根目录</span>
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      render: (size: number) => {
        if (size < 1024) return `${size} B`
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
        if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
        return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
      }
    },
    {
      title: '上传人',
      dataIndex: 'creator_name',
      key: 'creator_name'
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (time: string) => formatDateTime(time)
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <FileActions
          record={record}
          onPreview={(r) => {
            setSelectedFile(r)
            setPreviewFileId(r.id)
            setPreviewVisible(true)
          }}
          onDownload={handleDownload}
          onRename={handleRename}
          onMove={handleMoveFile}
          onRemoveFromSpace={handleRemoveFromSpace}
          onDelete={handleDelete}
        />
      )
    }
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys)
  }

  return (
    <div className="page-content">
      <Space style={{ marginBottom: 16, width: '100%' }} direction="vertical" size="middle">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input
              placeholder="搜索文件..."
              prefix={<SearchOutlined />}
              style={{ width: 300 }}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
            />
            {selectedRowKeys.length > 0 && (
              <Space>
                <span style={{ color: 'var(--text-secondary)' }}>已选 {selectedRowKeys.length} 个文件</span>
                <Button type="default" icon={<FolderOutlined />} onClick={handleBatchMove}>批量移动</Button>
                <Popconfirm
                  title={`确定将选中的 ${selectedRowKeys.length} 个文件移至回收站吗？`}
                  onConfirm={handleBatchDelete}
                  okText="确定"
                  cancelText="取消"
                  okType="danger"
                >
                  <Button type="default" danger icon={<DeleteOutlined />}>批量删除</Button>
                </Popconfirm>
                <Button type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
              </Space>
            )}
          </Space>
          <Space wrap>
            <Upload {...uploadProps}>
              <Button type="primary" icon={<UploadOutlined />}>上传文件</Button>
            </Upload>
            <Button type="default" onClick={() => setChunkUploadVisible(true)}>大文件上传（支持断点续传）</Button>
          </Space>
        </Space>
        <Space wrap align="center">
          <span style={{ color: 'var(--text-secondary)' }}>上传到（普通上传与大文件上传均生效）：</span>
          <Select
            placeholder="选择空间（有权限的空间，可选）"
            allowClear
            style={{ minWidth: 220 }}
            value={uploadSpaceId}
            onChange={(v) => { setUploadSpaceId(v); setUploadFolderId(undefined) }}
          >
            {spacesData?.data?.map((space: any) => (
              <Option key={space.id} value={space.id}>
                {space.name} ({space.type === 'team' ? '团队' : space.type === 'department' ? '部门' : space.type === 'personal' ? '个人' : '项目'})
              </Option>
            ))}
          </Select>
          <Select
            placeholder="选择文件夹（可选，需先选空间）"
            allowClear
            style={{ minWidth: 200 }}
            value={uploadFolderId ?? ROOT_FOLDER_VALUE}
            onChange={(v) => setUploadFolderId(v === ROOT_FOLDER_VALUE || v === null || v === undefined ? undefined : (v as number))}
            disabled={!uploadSpaceId}
            loading={!!uploadSpaceId && uploadFoldersData === undefined}
          >
            <Option value={ROOT_FOLDER_VALUE}>根目录</Option>
            {uploadFoldersData?.data && renderFolderOptions(uploadFoldersData.data)}
          </Select>
        </Space>
      </Space>

      {/* 大文件上传弹窗（分块上传，适合 50MB 以上） */}
      <Modal
        title="大文件上传（分块上传，支持断点续传）"
        open={chunkUploadVisible}
        onCancel={() => {
          setChunkUploadVisible(false)
          setChunkUploadPendingFile(null)
          setChunkUploadSpaceId(undefined)
          setChunkUploadFolderId(undefined)
        }}
        footer={null}
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap align="center">
            <span style={{ color: 'var(--text-secondary)' }}>上传到：</span>
            <Select
              placeholder="选择空间（可选，有权限的空间）"
              allowClear
              style={{ minWidth: 200 }}
              value={chunkUploadSpaceId}
              onChange={(v) => { setChunkUploadSpaceId(v); setChunkUploadFolderId(undefined) }}
            >
              {spacesData?.data?.map((space: any) => (
                <Option key={space.id} value={space.id}>
                  {space.name} ({space.type === 'team' ? '团队' : space.type === 'department' ? '部门' : space.type === 'personal' ? '个人' : '项目'})
                </Option>
              ))}
            </Select>
            <Select
              placeholder="选择文件夹（可选）"
              allowClear
              style={{ minWidth: 180 }}
              value={chunkUploadFolderId ?? ROOT_FOLDER_VALUE}
              onChange={(v) => setChunkUploadFolderId(v === ROOT_FOLDER_VALUE || v === null || v === undefined ? undefined : (v as number))}
              disabled={!chunkUploadSpaceId}
              loading={!!chunkUploadSpaceId && chunkUploadFoldersData === undefined}
            >
              <Option value={ROOT_FOLDER_VALUE}>根目录</Option>
              {chunkUploadFoldersData?.data && renderFolderOptions(chunkUploadFoldersData.data)}
            </Select>
          </Space>
          <ChunkUpload
            messageApi={messageApi}
            spaceId={chunkUploadSpaceId}
            folderId={chunkUploadFolderId}
            initialFile={chunkUploadPendingFile}
            onInitialFileConsumed={() => setChunkUploadPendingFile(null)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['files'] })
              setChunkUploadVisible(false)
              setChunkUploadPendingFile(null)
              setChunkUploadSpaceId(undefined)
              setChunkUploadFolderId(undefined)
            }}
          />
        </Space>
      </Modal>

      <Table
        rowSelection={rowSelection}
        columns={columns}
        dataSource={data?.data?.files || []}
        loading={isLoading}
        rowKey="id"
        pagination={{
          current: currentPage,
          pageSize,
          total: data?.data?.total || 0,
          showTotal: (total) => `共 ${total} 条`,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: (page, size) => {
            setCurrentPage(page)
            if (size != null) setPageSize(size)
          },
          onShowSizeChange: (_, size) => {
            setCurrentPage(1)
            setPageSize(size)
          }
        }}
      />

      {/* 移动文件弹窗（支持单个与批量） */}
      <Modal
        title={selectedRowKeys.length > 0 && !selectedFile ? `批量移动（${selectedRowKeys.length} 个文件）` : '移动文件到空间'}
        open={moveModalVisible}
        onCancel={() => {
          setMoveModalVisible(false)
          setSelectedFile(null)
          moveForm.resetFields()
        }}
        onOk={() => moveForm.submit()}
        width={500}
      >
        <Form
          form={moveForm}
          layout="vertical"
          onFinish={handleMoveConfirm}
        >
          <Form.Item
            name="spaceId"
            label="选择空间"
          >
            <Select
              placeholder="选择空间（留空表示移除空间关联）"
              allowClear
              onChange={() => {
                // 当空间改变时，清空文件夹选择
                moveForm.setFieldValue('folderId', null)
              }}
            >
              {spacesData?.data?.map((space: any) => (
                <Option key={space.id} value={space.id}>
                  {space.name} ({space.type === 'team' ? '团队空间' : space.type === 'department' ? '部门空间' : space.type === 'personal' ? '个人空间' : '项目空间'})
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="folderId"
            label="选择文件夹（可选）"
            extra="选择目标文件夹，留空表示移动到空间根目录"
          >
            <Select
              placeholder="选择文件夹（留空表示根目录）"
              allowClear
              disabled={!selectedSpaceId}
              loading={!foldersData && !!selectedSpaceId}
            >
              <Option value={ROOT_FOLDER_VALUE}>根目录（不分类到文件夹）</Option>
              {foldersData?.data && renderFolderOptions(foldersData.data)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重命名文件弹窗 */}
      <Modal
        title="重命名文件"
        open={renameModalVisible}
        onOk={() => renameForm.submit()}
        onCancel={() => {
          setRenameModalVisible(false)
          setSelectedFile(null)
          renameForm.resetFields()
        }}
      >
        <Form
          form={renameForm}
          onFinish={handleRenameConfirm}
          layout="vertical"
        >
          <Form.Item
            name="newName"
            label="新文件名"
            rules={[
              { required: true, message: '请输入文件名' },
              { min: 1, max: 255, message: '文件名长度在1-255个字符之间' }
            ]}
          >
            <Input placeholder="请输入新文件名" />
          </Form.Item>
        </Form>
      </Modal>

      <FilePreview
        fileId={previewFileId}
        fileName={selectedFile?.original_name}
        mimeType={selectedFile?.mime_type}
        visible={previewVisible}
        onClose={() => {
          setPreviewVisible(false)
          setPreviewFileId(null)
        }}
      />
    </div>
  )
}

// 递归渲染文件夹选项
function renderFolderOptions(folders: any[], level = 0): React.ReactNode[] {
  const { Option } = Select
  const options: React.ReactNode[] = []
  folders.forEach(folder => {
    const prefix = '  '.repeat(level)
    options.push(
      <Option key={folder.id} value={folder.id}>
        {prefix}{folder.name}
      </Option>
    )
    if (folder.children && folder.children.length > 0) {
      options.push(...renderFolderOptions(folder.children, level + 1))
    }
  })
  return options
}

