import { useState } from 'react'
import { Tabs, Table, Card, Button, Modal, Form, Input, Select, message, Space, Tag, Alert } from 'antd'
import { UserOutlined, FileTextOutlined, SettingOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'

const { Option } = Select

export default function Admin() {
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [form] = Form.useForm()
  const queryClient = useQueryClient()

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users')
  })

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['logs'],
    queryFn: () => api.get('/logs')
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
      title: '创建时间', 
      dataIndex: 'created_at', 
      key: 'created_at',
      render: (time: string) => time ? new Date(time).toLocaleString() : '-'
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
      render: (time: string) => time ? new Date(time).toLocaleString() : '-'
    }
  ]

  return (
    <div>
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
                  <h3>用户列表</h3>
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
                    pageSize: users?.data?.pageSize || 50,
                    current: users?.data?.page || 1,
                    showTotal: (total) => `共 ${total} 条记录`
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
                  pageSize: logs?.data?.pageSize || 50,
                  current: logs?.data?.page || 1,
                  showTotal: (total) => `共 ${total} 条记录`
                }}
              />
            )
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
