import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Card, 
  Descriptions, 
  Button, 
  Table, 
  Tabs, 
  Input, 
  message, 
  Modal, 
  Popconfirm,
  Space,
  Tag,
  Typography,
  Form
} from 'antd'
import { 
  ArrowLeftOutlined, 
  DownloadOutlined, 
  ShareAltOutlined,
  RollbackOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import api from '../services/api'
import { useAuthStore } from '../stores/authStore'
import FilePreview from '../components/FilePreview'

// 下载文件的辅助函数
const downloadFile = async (fileId: string, fileName: string) => {
  try {
    const token = useAuthStore.getState().token
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

const { TextArea } = Input
const { Text } = Typography

export default function FileDetail() {
  const { fileId } = useParams<{ fileId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [commentContent, setCommentContent] = useState('')
  const [shareModalVisible, setShareModalVisible] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)

  // 获取文件详情
  const { data: fileData, isLoading, error: fileError } = useQuery({
    queryKey: ['file', fileId],
    queryFn: () => api.get(`/files/${fileId}`)
  })

  console.log('FileDetail - fileId:', fileId)
  console.log('FileDetail - fileData:', fileData)
  console.log('FileDetail - fileError:', fileError)

  // API 拦截器返回 response.data，后端返回 { success: true, data: {...} }
  // 所以 fileData 已经是 { success: true, data: {...} }，需要访问 fileData.data
  const file = fileData?.data

  // 获取评论列表
  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ['comments', fileId],
    queryFn: () => api.get(`/comments/file/${fileId}`),
    enabled: !!fileId
  })

  const comments = commentsData?.data?.data || []

  // 添加评论
  const addCommentMutation = useMutation({
    mutationFn: (data: any) => api.post('/comments', data),
    onSuccess: () => {
      message.success('评论添加成功')
      setCommentContent('')
      refetchComments()
    },
    onError: (error: any) => {
      message.error(error.response?.data?.message || '添加评论失败')
    }
  })

  // 删除评论
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: number) => api.delete(`/comments/${commentId}`),
    onSuccess: () => {
      message.success('评论删除成功')
      refetchComments()
    },
    onError: (error: any) => {
      message.error(error.response?.data?.message || '删除评论失败')
    }
  })

  // 恢复版本
  const restoreVersionMutation = useMutation({
    mutationFn: (versionId: number) => api.post(`/files/${fileId}/restore-version`, { versionId }),
    onSuccess: () => {
      message.success('版本恢复成功')
      queryClient.invalidateQueries({ queryKey: ['file', fileId] })
    },
    onError: (error: any) => {
      message.error(error.response?.data?.message || '版本恢复失败')
    }
  })

  // 创建分享
  const createShareMutation = useMutation({
    mutationFn: (data: any) => api.post('/shares', {
      resourceType: 'file',
      resourceId: fileId,
      ...data
    }),
    onSuccess: (response) => {
      message.success('分享链接创建成功')
      const shareToken = response.data.data.shareToken
      const shareUrl = `${window.location.origin}/share/${shareToken}`
      Modal.info({
        title: '分享链接',
        content: (
          <div>
            <p>分享链接：</p>
            <Input value={shareUrl} readOnly />
            <p style={{ marginTop: 16 }}>请复制链接分享给他人</p>
          </div>
        ),
        width: 500
      })
      setShareModalVisible(false)
    },
    onError: (error: any) => {
      message.error(error.response?.data?.message || '创建分享失败')
    }
  })

  const handleAddComment = () => {
    if (!commentContent.trim()) {
      message.warning('请输入评论内容')
      return
    }
    addCommentMutation.mutate({
      fileId: parseInt(fileId!),
      content: commentContent
    })
  }

  const handleDeleteComment = (commentId: number) => {
    deleteCommentMutation.mutate(commentId)
  }

  const handleRestoreVersion = (versionId: number) => {
    restoreVersionMutation.mutate(versionId)
  }

  const handleCreateShare = (values: any) => {
    createShareMutation.mutate(values)
  }

  const versions = file?.versions || []

  const versionColumns = [
    {
      title: '版本号',
      dataIndex: 'version',
      key: 'version',
      render: (version: number) => `v${version}`
    },
    {
      title: '文件大小',
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
      title: '创建人',
      dataIndex: 'creator_name',
      key: 'creator_name'
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (time: string) => new Date(time).toLocaleString()
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm
          title="确定要恢复到此版本吗？"
          onConfirm={() => handleRestoreVersion(record.id)}
        >
          <Button type="link" icon={<RollbackOutlined />} size="small">
            恢复
          </Button>
        </Popconfirm>
      )
    }
  ]

  if (isLoading) {
    return <div>加载中...</div>
  }

  if (!file) {
    return <div>文件不存在</div>
  }

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <Button 
          icon={<DownloadOutlined />} 
          onClick={() => downloadFile(fileId!, file.original_name)}
        >
          下载
        </Button>
        <Button 
          icon={<ShareAltOutlined />} 
          onClick={() => setShareModalVisible(true)}
        >
          分享
        </Button>
        <Button onClick={() => setPreviewVisible(true)}>
          预览
        </Button>
      </Space>

      <Card title={file.original_name} style={{ marginBottom: 16 }}>
        <Descriptions column={2}>
          <Descriptions.Item label="文件大小">
            {file.file_size < 1024 ? `${file.file_size} B` :
             file.file_size < 1024 * 1024 ? `${(file.file_size / 1024).toFixed(2)} KB` :
             file.file_size < 1024 * 1024 * 1024 ? `${(file.file_size / 1024 / 1024).toFixed(2)} MB` :
             `${(file.file_size / 1024 / 1024 / 1024).toFixed(2)} GB`}
          </Descriptions.Item>
          <Descriptions.Item label="文件类型">
            {file.mime_type || '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="创建人">
            {file.creator_name || file.creator_real_name || '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(file.created_at).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="最后更新">
            {new Date(file.updated_at).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="当前版本">
            v{file.version}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        items={[
          {
            key: 'versions',
            label: `版本历史 (${versions.length})`,
            children: (
              <Table
                columns={versionColumns}
                dataSource={versions}
                rowKey="id"
                pagination={false}
              />
            )
          },
          {
            key: 'comments',
            label: `评论 (${comments.length})`,
            children: (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <TextArea
                    rows={4}
                    placeholder="输入评论内容..."
                    value={commentContent}
                    onChange={(e) => setCommentContent(e.target.value)}
                  />
                  <Button
                    type="primary"
                    style={{ marginTop: 8 }}
                    onClick={handleAddComment}
                    loading={addCommentMutation.isPending}
                  >
                    发表评论
                  </Button>
                </div>
                <div>
                  {comments.map((comment: any) => (
                    <Card
                      key={comment.id}
                      style={{ marginBottom: 8 }}
                      size="small"
                      extra={
                        (comment.user_id === user?.id || user?.role === 'admin') && (
                          <Popconfirm
                            title="确定要删除此评论吗？"
                            onConfirm={() => handleDeleteComment(comment.id)}
                          >
                            <Button
                              type="link"
                              danger
                              icon={<DeleteOutlined />}
                              size="small"
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        )
                      }
                    >
                      <div>
                        <Space>
                          <Text strong>{comment.username || comment.real_name || '未知用户'}</Text>
                          <Text type="secondary">
                            {new Date(comment.created_at).toLocaleString()}
                          </Text>
                        </Space>
                        <div style={{ marginTop: 8 }}>
                          {comment.content}
                        </div>
                        {comment.mentioned_users && (
                          <div style={{ marginTop: 8 }}>
                            {JSON.parse(comment.mentioned_users).map((userId: number) => (
                              <Tag key={userId}>@{userId}</Tag>
                            ))}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                  {comments.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                      暂无评论
                    </div>
                  )}
                </div>
              </div>
            )
          }
        ]}
      />

      {/* 分享弹窗 */}
      <Modal
        title="创建分享链接"
        open={shareModalVisible}
        onCancel={() => setShareModalVisible(false)}
        footer={null}
      >
        <ShareForm onFinish={handleCreateShare} />
      </Modal>

      {/* 预览 */}
      <FilePreview
        fileId={parseInt(fileId!)}
        fileName={file.original_name}
        mimeType={file.mime_type}
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
      />
    </div>
  )
}

// 分享表单组件
function ShareForm({ onFinish }: { onFinish: (values: any) => void }) {
  const [form] = Form.useForm()

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={onFinish}
    >
      <Form.Item
        name="password"
        label="访问密码（可选）"
        rules={[
          { min: 4, max: 16, message: '密码长度在4-16位之间' }
        ]}
      >
        <Input.Password placeholder="设置4-16位密码" />
      </Form.Item>
      <Form.Item
        name="allowedEmails"
        label="允许访问的邮箱（可选，多个用逗号分隔）"
      >
        <Input.TextArea
          rows={3}
          placeholder="email1@example.com, email2@example.com"
        />
      </Form.Item>
      <Form.Item
        name="expiresInDays"
        label="有效期（天）"
      >
        <Input placeholder="输入天数（如：7、30、90）" type="number" />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit" block>
          创建分享
        </Button>
      </Form.Item>
    </Form>
  )
}

