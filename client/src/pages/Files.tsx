import { useState, useEffect } from 'react'
import { Table, Button, Upload, Space, Input, message, Modal, Form, Select, Popconfirm } from 'antd'
import { UploadOutlined, SearchOutlined, EyeOutlined, FileTextOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'
import FilePreview from '../components/FilePreview'
import type { UploadProps } from 'antd'

const { Option } = Select

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
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [moveModalVisible, setMoveModalVisible] = useState(false)
  const [selectedFile, setSelectedFile] = useState<any>(null)
  const [moveForm] = Form.useForm()
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewFileId, setPreviewFileId] = useState<number | null>(null)
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [renameForm] = Form.useForm()
  // const [advancedSearchVisible, setAdvancedSearchVisible] = useState(false) // 暂时未使用
  // const [searchForm] = Form.useForm() // 暂时未使用
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

  const { data, isLoading } = useQuery({
    queryKey: ['files', currentPage, debouncedKeyword],
    queryFn: () => api.get('/files/list', {
      params: { page: currentPage, pageSize: 20, keyword: debouncedKeyword || undefined }
    })
  })

  // 下载文件（支持选择保存路径）
  const handleDownload = async (fileId: number, fileName: string) => {
    try {
      const response = await fetch(`/api/files/download/${fileId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const error = await response.json()
        message.error(error.message || '下载失败')
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
          
          message.success('文件保存成功')
        } catch (saveError: any) {
          // 用户取消选择，不显示错误
          if (saveError.name !== 'AbortError' && saveError.name !== 'NotAllowedError') {
            console.error('保存文件失败:', saveError)
            // 如果 File System Access API 失败，回退到传统下载方式
            downloadWithFallback(blob, fileName)
          }
          // 如果是用户取消或权限拒绝，不显示错误消息
        }
      } else {
        // 不支持 File System Access API，使用传统下载方式
        downloadWithFallback(blob, fileName)
      }
    } catch (error: any) {
      console.error('下载错误:', error)
      message.error(error.message || '下载失败')
    }
  }

  // 传统下载方式（回退方案）
  const downloadWithFallback = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    
    // 清理
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    message.success('文件下载成功（已保存到浏览器默认下载文件夹）')
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

  // 移动文件到空间
  const handleMoveFile = (file: any) => {
    setSelectedFile(file)
    setMoveModalVisible(true)
    moveForm.setFieldsValue({
      spaceId: file.space_id || undefined,
      folderId: file.folder_id || undefined
    })
  }

  const handleMoveConfirm = async (values: any) => {
    if (!selectedFile) return
    try {
      await api.patch(`/files/${selectedFile.id}/move`, values)
      message.success('文件移动成功')
      setMoveModalVisible(false)
      setSelectedFile(null)
      moveForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['files'] })
    } catch (error: any) {
      message.error(error.message || '移动失败')
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
    action: '/api/files/upload',
    headers: {
      Authorization: `Bearer ${token}`
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
        const error = info.file.error || info.file.response
        const errorMsg = error?.message || error?.error?.message || `${info.file.name} 上传失败`
        message.error(errorMsg)
        console.error('上传错误:', error)
      }
    },
    beforeUpload: (file) => {
      // 可以在这里添加文件大小检查
      const isLt10GB = file.size / 1024 / 1024 / 1024 < 10
      if (!isLt10GB) {
        message.error('文件大小不能超过10GB')
        return false
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
          style={{ color: '#1890ff' }}
        >
          {text}
        </a>
      )
    },
    {
      title: '所属空间',
      dataIndex: 'space_name',
      key: 'space_name',
      render: (name: string) => name || <span style={{ color: '#999' }}>未分类</span>
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
      render: (time: string) => new Date(time).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button 
            type="link" 
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => navigate(`/files/${record.id}`)}
          >
            详情
          </Button>
          <Button 
            type="link" 
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedFile(record)
              setPreviewFileId(record.id)
              setPreviewVisible(true)
            }}
          >
            预览
          </Button>
          <Button 
            type="link" 
            size="small"
            onClick={() => handleDownload(record.id, record.original_name)}
          >
            下载
          </Button>
          <Button 
            type="link" 
            size="small"
            onClick={() => handleRename(record)}
          >
            重命名
          </Button>
          <Button 
            type="link" 
            size="small"
            onClick={() => handleMoveFile(record)}
          >
            移动
          </Button>
          {record.space_id && (
            <Button 
              type="link" 
              size="small"
              onClick={() => handleRemoveFromSpace(record.id)}
            >
              从空间移除
            </Button>
          )}
          <Popconfirm
            title="确定要删除此文件吗？"
            description="文件将被移至回收站，可在回收站中恢复或永久删除"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
            okType="danger"
          >
            <Button 
              type="link" 
              size="small" 
              danger
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Input
          placeholder="搜索文件..."
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
        />
        <Upload {...uploadProps}>
          <Button type="primary" icon={<UploadOutlined />}>
            上传文件
          </Button>
        </Upload>
      </Space>

      <Table
        columns={columns}
        dataSource={data?.data?.files || []}
        loading={isLoading}
        rowKey="id"
        pagination={{
          current: currentPage,
          pageSize: 20,
          total: data?.data?.total || 0,
          onChange: (page) => setCurrentPage(page)
        }}
      />

      {/* 移动文件弹窗 */}
      <Modal
        title="移动文件到空间"
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
          >
            <Select
              placeholder="选择文件夹（可选）"
              allowClear
              disabled={!moveForm.getFieldValue('spaceId')}
            >
              {/* 文件夹选项需要根据选择的空间动态加载 */}
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

