import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, List, Button, Space, Modal, Form, Input, Select, message, Table, Tag, Popconfirm } from 'antd'
import { FolderOutlined, PlusOutlined, UserOutlined, SettingOutlined, FileOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'

const { Option } = Select

export default function Spaces() {
  const navigate = useNavigate()
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [membersModalVisible, setMembersModalVisible] = useState(false)
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null)
  const [selectedSpace, setSelectedSpace] = useState<any>(null)
  const [form] = Form.useForm()
  const [memberForm] = Form.useForm()
  const [settingsForm] = Form.useForm()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const { data: spaces, isLoading } = useQuery({
    queryKey: ['spaces'],
    queryFn: () => api.get('/spaces')
  })

  // 获取用户列表（用于添加成员）
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users'),
    enabled: false // 只在需要时查询
  })

  // 获取空间成员
  const { data: membersData, refetch: refetchMembers } = useQuery({
    queryKey: ['space-members', selectedSpaceId],
    queryFn: () => api.get(`/spaces/${selectedSpaceId}/members`),
    enabled: !!selectedSpaceId
  })

  // 获取空间详情（用于设置）
  // const { data: spaceDetail } = useQuery({
  //   queryKey: ['space-detail', selectedSpaceId],
  //   queryFn: () => api.get(`/spaces/${selectedSpaceId}`),
  //   enabled: !!selectedSpaceId && settingsModalVisible
  // })

  // 创建空间
  const createSpaceMutation = useMutation({
    mutationFn: (data: any) => api.post('/spaces', data),
    onSuccess: () => {
      message.success('空间创建成功')
      setCreateModalVisible(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (error: any) => {
      message.error(error.message || '创建空间失败')
    }
  })

  // 添加空间成员
  const addMembersMutation = useMutation({
    mutationFn: ({ spaceId, data }: { spaceId: number, data: any }) => 
      api.post(`/spaces/${spaceId}/members`, data),
    onSuccess: () => {
      message.success('成员添加成功')
      memberForm.resetFields()
      refetchMembers()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (error: any) => {
      message.error(error.message || '添加成员失败')
    }
  })

  // 移除空间成员
  const removeMemberMutation = useMutation({
    mutationFn: ({ spaceId, userId }: { spaceId: number, userId: number }) =>
      api.delete(`/spaces/${spaceId}/members/${userId}`),
    onSuccess: () => {
      message.success('成员已移除')
      refetchMembers()
    },
    onError: (error: any) => {
      message.error(error.message || '移除成员失败')
    }
  })

  // 更新空间信息
  const updateSpaceMutation = useMutation({
    mutationFn: ({ spaceId, data }: { spaceId: number, data: any }) =>
      api.put(`/spaces/${spaceId}`, data),
    onSuccess: () => {
      message.success('空间信息更新成功')
      setSettingsModalVisible(false)
      setSelectedSpaceId(null)
      setSelectedSpace(null)
      settingsForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
    onError: (error: any) => {
      message.error(error.message || '更新空间信息失败')
    }
  })


  const handleCreateSpace = async (values: any) => {
    await createSpaceMutation.mutateAsync(values)
  }

  const handleAddMembers = async (values: any) => {
    if (!selectedSpaceId) return
    await addMembersMutation.mutateAsync({
      spaceId: selectedSpaceId,
      data: values
    })
  }

  const handleRemoveMember = async (userId: number) => {
    if (!selectedSpaceId) return
    await removeMemberMutation.mutateAsync({
      spaceId: selectedSpaceId,
      userId
    })
  }

  const handleManageMembers = (spaceId: number) => {
    setSelectedSpaceId(spaceId)
    setMembersModalVisible(true)
    // 加载用户列表
    queryClient.fetchQuery({ queryKey: ['users'] })
  }

  const handleOpenSettings = (space: any) => {
    setSelectedSpaceId(space.id)
    setSelectedSpace(space)
    setSettingsModalVisible(true)
    // 设置表单初始值
    settingsForm.setFieldsValue({
      name: space.name,
      description: space.description
    })
  }

  const handleViewSpaceDetail = (space: any) => {
    navigate(`/spaces/${space.id}`)
  }

  const handleUpdateSpace = async (values: any) => {
    if (!selectedSpaceId) return
    await updateSpaceMutation.mutateAsync({
      spaceId: selectedSpaceId,
      data: values
    })
  }

  // 空间类型映射
  const spaceTypeMap: Record<string, string> = {
    team: '团队公共空间',
    department: '部门空间',
    personal: '个人空间',
    project: '项目专属空间'
  }

  // 权限类型映射
  const permissionTypeMap: Record<string, string> = {
    read: '查看',
    write: '编辑',
    delete: '删除',
    comment: '评论',
    download: '下载'
  }

  // 根据用户角色确定可创建的空间类型
  const getAvailableSpaceTypes = () => {
    if (user?.role === 'admin') {
      return [
        { value: 'team', label: '团队公共空间' },
        { value: 'department', label: '部门空间' },
        { value: 'personal', label: '个人空间' },
        { value: 'project', label: '项目专属空间' }
      ]
    } else {
      return [
        { value: 'personal', label: '个人空间' },
        { value: 'project', label: '项目专属空间' }
      ]
    }
  }

  // 成员列表表格列
  const memberColumns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username'
    },
    {
      title: '真实姓名',
      dataIndex: 'real_name',
      key: 'real_name'
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email'
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions: string[]) => (
        <Space>
          {permissions.map(perm => (
            <Tag key={perm} color="blue">{permissionTypeMap[perm] || perm}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm
          title="确定要移除该成员吗？"
          onConfirm={() => handleRemoveMember(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger size="small">移除</Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <h2>空间管理</h2>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          创建空间
        </Button>
      </Space>

      <List
        grid={{ gutter: 16, column: 4 }}
        dataSource={spaces?.data || []}
        loading={isLoading}
        renderItem={(item: any) => (
          <List.Item>
            <Card
              hoverable
              cover={<FolderOutlined style={{ fontSize: 48, padding: 24, textAlign: 'center' }} />}
              actions={[
                <Button 
                  type="link" 
                  icon={<FileOutlined />}
                  onClick={() => handleViewSpaceDetail(item)}
                >
                  查看详情
                </Button>,
                <Button 
                  type="link" 
                  icon={<UserOutlined />}
                  onClick={() => handleManageMembers(item.id)}
                >
                  成员管理
                </Button>,
                <Button 
                  type="link" 
                  icon={<SettingOutlined />}
                  onClick={() => handleOpenSettings(item)}
                >
                  设置
                </Button>
              ]}
            >
              <Card.Meta
                title={item.name}
                description={spaceTypeMap[item.type] || item.type}
              />
            </Card>
          </List.Item>
        )}
      />

      {/* 创建空间弹窗 */}
      <Modal
        title="创建新空间"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={createSpaceMutation.isPending}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateSpace}
        >
          <Form.Item
            name="name"
            label="空间名称"
            rules={[
              { required: true, message: '请输入空间名称' },
              { min: 2, message: '空间名称至少2个字符' },
              { max: 50, message: '空间名称最多50个字符' }
            ]}
          >
            <Input placeholder="请输入空间名称" />
          </Form.Item>

          <Form.Item
            name="type"
            label="空间类型"
            rules={[{ required: true, message: '请选择空间类型' }]}
          >
            <Select placeholder="请选择空间类型">
              {getAvailableSpaceTypes().map(type => (
                <Option key={type.value} value={type.value}>
                  {type.label}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="description"
            label="空间描述"
          >
            <Input.TextArea 
              placeholder="请输入空间描述（可选）"
              rows={4}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 成员管理弹窗 */}
      <Modal
        title="空间成员管理"
        open={membersModalVisible}
        onCancel={() => {
          setMembersModalVisible(false)
          setSelectedSpaceId(null)
          memberForm.resetFields()
        }}
        footer={null}
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <h3>空间所有者</h3>
          {membersData?.data?.owner && (
            <Card size="small">
              <Space>
                <UserOutlined />
                <span>{membersData.data.owner.real_name || membersData.data.owner.username}</span>
                <Tag color="gold">所有者</Tag>
              </Space>
            </Card>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3>空间成员</h3>
          <Table
            columns={memberColumns}
            dataSource={membersData?.data?.members || []}
            rowKey="id"
            pagination={false}
            size="small"
          />
        </div>

        <div>
          <h3>添加成员</h3>
          <Form
            form={memberForm}
            layout="inline"
            onFinish={handleAddMembers}
          >
            <Form.Item
              name="userIds"
              label="选择用户"
              rules={[{ required: true, message: '请选择用户' }]}
              style={{ width: 300 }}
            >
              <Select
                mode="multiple"
                placeholder="请选择用户"
                showSearch
                filterOption={(input, option: any) => {
                  const children = option?.children
                  if (typeof children === 'string') {
                    return children.toLowerCase().includes(input.toLowerCase())
                  }
                  return false
                }}
              >
                {usersData?.data?.users?.map((u: any) => (
                  <Option key={u.id} value={u.id}>
                    {u.real_name || u.username} ({u.email})
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="permissionTypes"
              label="权限类型"
              rules={[{ required: true, message: '请选择权限类型' }]}
            >
              <Select
                mode="multiple"
                placeholder="请选择权限"
                style={{ width: 200 }}
              >
                <Option value="read">查看</Option>
                <Option value="write">编辑</Option>
                <Option value="delete">删除</Option>
                <Option value="comment">评论</Option>
                <Option value="download">下载</Option>
              </Select>
            </Form.Item>

            <Form.Item>
              <Button 
                type="primary" 
                htmlType="submit"
                loading={addMembersMutation.isPending}
              >
                添加
              </Button>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* 空间设置弹窗 */}
      <Modal
        title="空间设置"
        open={settingsModalVisible}
        onCancel={() => {
          setSettingsModalVisible(false)
          setSelectedSpaceId(null)
          setSelectedSpace(null)
          settingsForm.resetFields()
        }}
        onOk={() => settingsForm.submit()}
        confirmLoading={updateSpaceMutation.isPending}
        width={600}
      >
        <Form
          form={settingsForm}
          layout="vertical"
          onFinish={handleUpdateSpace}
        >
          <Form.Item
            name="name"
            label="空间名称"
            rules={[
              { required: true, message: '请输入空间名称' },
              { min: 2, message: '空间名称至少2个字符' },
              { max: 50, message: '空间名称最多50个字符' }
            ]}
          >
            <Input placeholder="请输入空间名称" />
          </Form.Item>

          <Form.Item
            name="description"
            label="空间描述"
          >
            <Input.TextArea 
              placeholder="请输入空间描述（可选）"
              rows={4}
            />
          </Form.Item>

          {selectedSpace && (
            <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <div><strong>空间类型：</strong>{spaceTypeMap[selectedSpace.type] || selectedSpace.type}</div>
              <div style={{ marginTop: 8 }}>
                <strong>创建时间：</strong>
                {new Date(selectedSpace.created_at).toLocaleString()}
              </div>
              {selectedSpace.owner_name && (
                <div style={{ marginTop: 8 }}>
                  <strong>所有者：</strong>{selectedSpace.owner_name}
                </div>
              )}
            </div>
          )}
        </Form>
      </Modal>

    </div>
  )
}

