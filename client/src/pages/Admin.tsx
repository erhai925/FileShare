import { useState } from 'react'
import { Tabs, Table, Card, Button, Modal, Form, Input, Select, message, Space, Tag, Alert, Popconfirm } from 'antd'
import { UserOutlined, FileTextOutlined, SettingOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined, EditOutlined, DeleteOutlined, KeyOutlined, CloudOutlined, DownloadOutlined, RollbackOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuthStore } from '../stores/authStore'
import { formatDateTime } from '../utils/date'

const { Option } = Select

export default function Admin() {
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [resetPasswordModalVisible, setResetPasswordModalVisible] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [resettingUser, setResettingUser] = useState<any>(null)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const [resetPasswordForm] = Form.useForm()
  const queryClient = useQueryClient()
  const [usersPage, setUsersPage] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(50)
  const [logsPage, setLogsPage] = useState(1)
  const [logsPageSize, setLogsPageSize] = useState(50)

  const { data: users } = useQuery({
    queryKey: ['users', usersPage, usersPageSize],
    queryFn: () => api.get('/users', { params: { page: usersPage, pageSize: usersPageSize } })
  })

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['logs', logsPage, logsPageSize],
    queryFn: () => api.get('/logs', { params: { page: logsPage, pageSize: logsPageSize } })
  })

  // 创建用户
  const createUserMutation = useMutation({
    mutationFn: (data: any) => api.post('/users', data),
    onSuccess: () => {
      message.success('用户创建成功')
      setCreateModalVisible(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      message.error(error.message || '创建用户失败')
    }
  })

  const handleCreateUser = async (values: any) => {
    await createUserMutation.mutateAsync(values)
  }

  // 更新用户
  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: number, data: any }) => api.patch(`/users/${userId}`, data),
    onSuccess: () => {
      message.success('用户信息更新成功')
      setEditModalVisible(false)
      setEditingUser(null)
      editForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      message.error(error.message || '更新用户失败')
    }
  })

  // 切换用户状态（启用/禁用）
  const toggleUserStatusMutation = useMutation({
    mutationFn: (userId: number) => api.post(`/users/${userId}/toggle-status`),
    onSuccess: () => {
      message.success('用户状态已更新')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      message.error(error.message || '更新用户状态失败')
    }
  })

  // 删除用户
  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => api.delete(`/users/${userId}`),
    onSuccess: () => {
      message.success('用户已删除')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      message.error(error.message || '删除用户失败')
    }
  })

  // 重置用户密码
  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, newPassword }: { userId: number, newPassword: string }) => 
      api.post(`/users/${userId}/reset-password`, { newPassword }),
    onSuccess: () => {
      message.success('用户密码已重置')
      setResetPasswordModalVisible(false)
      setResettingUser(null)
      resetPasswordForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      message.error(error.message || '重置密码失败')
    }
  })

  const handleEditUser = (user: any) => {
    setEditingUser(user)
    editForm.setFieldsValue({
      role: user.role,
      status: user.status,
      realName: user.real_name || ''
    })
    setEditModalVisible(true)
  }

  const handleUpdateUser = async (values: any) => {
    if (!editingUser) return
    await updateUserMutation.mutateAsync({
      userId: editingUser.id,
      data: values
    })
  }

  const handleToggleStatus = async (user: any) => {
    await toggleUserStatusMutation.mutateAsync(user.id)
  }

  const handleDeleteUser = async (user: any) => {
    await deleteUserMutation.mutateAsync(user.id)
  }

  const handleResetPassword = (user: any) => {
    setResettingUser(user)
    resetPasswordForm.resetFields()
    setResetPasswordModalVisible(true)
  }

  const handleResetPasswordSubmit = async (values: any) => {
    if (!resettingUser) return
    await resetPasswordMutation.mutateAsync({
      userId: resettingUser.id,
      newPassword: values.newPassword
    })
  }

  const userColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { 
      title: '角色', 
      dataIndex: 'role', 
      key: 'role',
      render: (role: string) => {
        const roleMap: Record<string, string> = {
          admin: '管理员',
          editor: '编辑者',
          viewer: '查看者',
          commenter: '仅评论者'
        }
        return roleMap[role] || role
      }
    },
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string) => {
        return status === 'active' ? '启用' : '禁用'
      }
    },
    { 
      title: '登录次数', 
      dataIndex: 'login_count', 
      key: 'login_count',
      width: 100,
      render: (count: number) => count ?? 0
    },
    { 
      title: '创建时间', 
      dataIndex: 'created_at', 
      key: 'created_at',
      render: (time: string) => formatDateTime(time)
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditUser(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<KeyOutlined />}
            onClick={() => handleResetPassword(record)}
          >
            重置密码
          </Button>
          <Popconfirm
            title={`确定要${record.status === 'active' ? '禁用' : '启用'}该用户吗？`}
            onConfirm={() => handleToggleStatus(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger={record.status === 'active'}
            >
              {record.status === 'active' ? '禁用' : '启用'}
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确定要删除该用户吗？此操作不可恢复！"
            description="删除用户将同时删除该用户的所有权限和用户组关联"
            onConfirm={() => handleDeleteUser(record)}
            okText="确定删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  const logColumns = [
    { title: '用户', dataIndex: 'username', key: 'username' },
    { title: '操作', dataIndex: 'action', key: 'action' },
    { title: '资源类型', dataIndex: 'resource_type', key: 'resource_type' },
    { title: 'IP地址', dataIndex: 'ip_address', key: 'ip_address' },
    { 
      title: '时间', 
      dataIndex: 'created_at', 
      key: 'created_at',
      render: (time: string) => formatDateTime(time)
    }
  ]

  return (
    <div className="page-content">
      <Tabs
        items={[
          {
            key: 'users',
            label: (
              <span>
                <UserOutlined />
                用户管理
              </span>
            ),
            children: (
              <div>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="page-title" style={{ marginBottom: 0 }}>用户列表</h3>
                  <Button 
                    type="primary" 
                    icon={<PlusOutlined />}
                    onClick={() => setCreateModalVisible(true)}
                  >
                    创建用户
                  </Button>
                </div>
                <Table
                  columns={userColumns}
                  dataSource={users?.data?.users || []}
                  rowKey="id"
                  loading={false}
                  pagination={{
                    total: users?.data?.total || 0,
                    current: usersPage,
                    pageSize: usersPageSize,
                    showTotal: (total) => `共 ${total} 条记录`,
                    showSizeChanger: true,
                    pageSizeOptions: ['20', '50', '100'],
                    onChange: (page, size) => {
                      setUsersPage(page)
                      if (size != null) setUsersPageSize(size)
                    },
                    onShowSizeChange: (_, size) => {
                      setUsersPage(1)
                      setUsersPageSize(size)
                    }
                  }}
                />
              </div>
            )
          },
          {
            key: 'logs',
            label: (
              <span>
                <FileTextOutlined />
                操作日志
              </span>
            ),
            children: (
              <Table
                columns={logColumns}
                dataSource={logs?.data?.logs || []}
                rowKey="id"
                loading={logsLoading}
                pagination={{
                  total: logs?.data?.total || 0,
                  current: logsPage,
                  pageSize: logsPageSize,
                  showTotal: (total) => `共 ${total} 条记录`,
                  showSizeChanger: true,
                  pageSizeOptions: ['20', '50', '100'],
                  onChange: (page, size) => {
                    setLogsPage(page)
                    if (size != null) setLogsPageSize(size)
                  },
                  onShowSizeChange: (_, size) => {
                    setLogsPage(1)
                    setLogsPageSize(size)
                  }
                }}
              />
            )
          },
          {
            key: 'backup',
            label: (
              <span>
                <CloudOutlined />
                数据备份
              </span>
            ),
            children: <BackupSettings />
          },
          {
            key: 'settings',
            label: (
              <span>
                <SettingOutlined />
                系统设置
              </span>
            ),
            children: <StorageSettings />
          }
        ]}
      />

      {/* 创建用户弹窗 */}
      <Modal
        title="创建新用户"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={createUserMutation.isPending}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateUser}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少3个字符' },
              { max: 20, message: '用户名最多20个字符' }
            ]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码长度至少6位' }
            ]}
          >
            <Input.Password placeholder="请输入密码（至少6位）" />
          </Form.Item>

          <Form.Item
            name="realName"
            label="真实姓名"
          >
            <Input placeholder="请输入真实姓名（可选）" />
          </Form.Item>

          <Form.Item
            name="role"
            label="角色"
            initialValue="viewer"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Option value="viewer">查看者</Option>
              <Option value="editor">编辑者</Option>
              <Option value="commenter">仅评论者</Option>
              <Option value="admin">管理员</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            initialValue="active"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择状态">
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户弹窗 */}
      <Modal
        title="编辑用户"
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false)
          setEditingUser(null)
          editForm.resetFields()
        }}
        onOk={() => editForm.submit()}
        confirmLoading={updateUserMutation.isPending}
        width={600}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleUpdateUser}
        >
          <Form.Item label="用户名">
            <Input value={editingUser?.username} disabled />
          </Form.Item>

          <Form.Item label="邮箱">
            <Input value={editingUser?.email} disabled />
          </Form.Item>

          <Form.Item
            name="realName"
            label="真实姓名"
          >
            <Input placeholder="请输入真实姓名（可选）" />
          </Form.Item>

          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Option value="viewer">查看者</Option>
              <Option value="editor">编辑者</Option>
              <Option value="commenter">仅评论者</Option>
              <Option value="admin">管理员</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择状态">
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码弹窗 */}
      <Modal
        title="重置用户密码"
        open={resetPasswordModalVisible}
        onCancel={() => {
          setResetPasswordModalVisible(false)
          setResettingUser(null)
          resetPasswordForm.resetFields()
        }}
        onOk={() => resetPasswordForm.submit()}
        confirmLoading={resetPasswordMutation.isPending}
        width={500}
      >
        <Alert
          message="重置密码提示"
          description={`您正在为用户 "${resettingUser?.username}" 重置登录密码。重置后，用户需要使用新密码登录。`}
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={resetPasswordForm}
          layout="vertical"
          onFinish={handleResetPasswordSubmit}
        >
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码长度至少6位' }
            ]}
          >
            <Input.Password placeholder="请输入新密码（至少6位）" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                }
              })
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// 数据备份组件
function BackupSettings() {
  const { data: backupsData, refetch } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: () => api.get('/admin/backups')
  })
  // 12GB+ 存储且使用最高压缩时，备份可能需 15–30 分钟，超时设为 30 分钟
  const backupMutation = useMutation({
    mutationFn: () => api.post('/admin/backup', {}, { timeout: 1800000 }),
    onSuccess: () => {
      message.success('备份完成')
      refetch()
    },
    onError: (error: any) => {
      message.error(error.message || '备份失败')
    }
  })
  const restoreMutation = useMutation({
    mutationFn: (filename: string) => api.post('/admin/backups/restore', { filename }, { timeout: 1800000 }),
    onSuccess: () => {
      message.success('数据恢复成功，请刷新页面')
      refetch()
      setTimeout(() => window.location.reload(), 1500)
    },
    onError: (error: any) => {
      message.error(error.message || '恢复失败')
    }
  })
  const backups = backupsData?.data || []
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }
  const { token } = useAuthStore()
  const handleDownload = async (filename: string) => {
    try {
      const res = await fetch(`/api/admin/backups/${filename}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (!res.ok) throw new Error('下载失败')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
      message.success('下载成功')
    } catch (e: any) {
      message.error(e.message || '下载失败')
    }
  }
  return (
    <div>
      <Card title="数据备份" style={{ marginBottom: 16 }}>
        <Alert
          message="备份说明"
          description="备份包含数据库和存储文件。备份文件保存在项目根目录下的 backups 文件夹中。恢复操作将覆盖当前数据，请谨慎操作。建议定期备份重要数据。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<CloudOutlined />}
            onClick={() => backupMutation.mutate()}
            loading={backupMutation.isPending}
          >
            立即备份
          </Button>
        </div>
        <Table
          columns={[
            { title: '文件名', dataIndex: 'filename', key: 'filename' },
            {
              title: '大小',
              dataIndex: 'size',
              key: 'size',
              render: (v: number) => formatSize(v)
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (v: string) => formatDateTime(v)
            },
            {
              title: '操作',
              key: 'action',
              render: (_: any, record: any) => (
                <Space>
                  <Button
                    type="link"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownload(record.filename)}
                  >
                    下载
                  </Button>
                  <Popconfirm
                    title="确定要恢复此备份吗？"
                    description="恢复将覆盖当前所有数据，此操作不可撤销。建议先备份当前数据。"
                    onConfirm={() => restoreMutation.mutate(record.filename)}
                    okText="确定恢复"
                    cancelText="取消"
                    okType="danger"
                  >
                    <Button
                      type="link"
                      size="small"
                      icon={<RollbackOutlined />}
                      loading={restoreMutation.isPending}
                    >
                      恢复
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
          dataSource={backups}
          rowKey="filename"
          pagination={false}
          locale={{ emptyText: '暂无备份，点击上方按钮创建' }}
        />
      </Card>
    </div>
  )
}

// 存储设置组件
function StorageSettings() {
  const [testLoading, setTestLoading] = useState(false)
  const [form] = Form.useForm()
  const queryClient = useQueryClient()

  const { data: storageData, refetch } = useQuery({
    queryKey: ['storage-config'],
    queryFn: () => api.get('/admin/storage')
  })

  const updateStorageMutation = useMutation({
    mutationFn: (data: any) => api.post('/admin/storage', data),
    onSuccess: () => {
      message.success('存储路径配置更新成功')
      form.resetFields()
      refetch()
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
    onError: (error: any) => {
      message.error(error.message || '更新存储路径配置失败')
    }
  })

  const testStorageMutation = useMutation({
    mutationFn: (data: any) => api.post('/admin/storage/test', data),
    onSuccess: (data: any) => {
      if (data.data.valid && data.data.writable) {
        message.success('存储路径测试通过')
      } else {
        message.warning(data.data.message || '存储路径测试失败')
      }
    },
    onError: (error: any) => {
      message.error(error.message || '测试存储路径失败')
    }
  })

  const handleUpdateStorage = async (values: any) => {
    await updateStorageMutation.mutateAsync({ path: values.path })
  }

  const handleTestStorage = async () => {
    const path = form.getFieldValue('path')
    if (!path) {
      message.warning('请先输入存储路径')
      return
    }
    setTestLoading(true)
    try {
      await testStorageMutation.mutateAsync({ path })
    } finally {
      setTestLoading(false)
    }
  }

  const storageInfo = storageData?.data

  return (
    <div>
      <Card title="存储路径配置" style={{ marginBottom: 16 }}>
        <Alert
          message="存储路径说明"
          description={
            <div>
              <p>• 支持本地路径，如：<code>/data/storage</code> 或 <code>D:\FileShare\storage</code></p>
              <p>• 支持网络路径（NAS），如：<code>\\192.168.1.100\share</code> 或 <code>/mnt/nas/storage</code></p>
              <p>• 路径必须存在且可写，系统会自动创建必要的子目录</p>
              <p>• 修改存储路径后，新上传的文件将存储到新路径，旧文件仍保留在原路径</p>
            </div>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {storageInfo && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <strong>当前存储路径：</strong>
                <code style={{ marginLeft: 8 }}>{storageInfo.path}</code>
              </div>
              <div>
                <strong>状态：</strong>
                {storageInfo.valid && storageInfo.writable ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    正常
                  </Tag>
                ) : (
                  <Tag color="error" icon={<CloseCircleOutlined />}>
                    {storageInfo.message || '异常'}
                  </Tag>
                )}
              </div>
            </Space>
          </div>
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleUpdateStorage}
          initialValues={storageInfo ? { path: storageInfo.path } : {}}
        >
          <Form.Item
            name="path"
            label="存储路径"
            rules={[
              { required: true, message: '请输入存储路径' },
              { min: 1, message: '存储路径不能为空' }
            ]}
            extra="请输入完整的存储路径，系统会自动验证路径的有效性"
          >
            <Input
              placeholder="例如：/data/storage 或 \\192.168.1.100\share"
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="default"
                onClick={handleTestStorage}
                loading={testLoading}
              >
                测试路径
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={updateStorageMutation.isPending}
              >
                保存配置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
