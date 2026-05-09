import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Modal, List, Button, Space, message, Empty, Tag, Spin, Form, Select,
  Typography, Divider, Alert
} from 'antd'
import { UserOutlined, DeleteOutlined } from '@ant-design/icons'
import api from '../../services/api'
import { wikiApi } from '../../services/wikiService'
import { useAuthStore } from '../../stores/authStore'

const { Text } = Typography

const PERMISSION_OPTIONS = [
  { value: 'read', label: '读取' },
  { value: 'write', label: '编辑' },
  { value: 'comment', label: '评论' },
  { value: 'delete', label: '删除' },
  { value: 'download', label: '下载' }
]

interface Props {
  open: boolean
  pageId: number
  pageTitle?: string
  onClose: () => void
}

/**
 * 页面级权限管理对话框（F13）：
 * - 仅管理员可见可改（POST/DELETE /api/permissions 现有逻辑限制 admin）
 * - 列出当前 wiki_page 资源所有权限记录（按 user/group 聚合）
 * - 支持：添加用户/组权限、整组撤销
 */
export default function PermissionDialog({ open, pageId, pageTitle, onClose }: Props) {
  const qc = useQueryClient()
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.role === 'admin'

  const [form] = Form.useForm()

  const { data: permsData, isLoading } = useQuery({
    queryKey: ['wiki', 'page-perms', pageId],
    queryFn: () => wikiApi.listPagePermissions(pageId),
    enabled: open
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get<any, any>('/users'),
    enabled: open && isAdmin
  })

  const setPerm = useMutation({
    mutationFn: (data: any) => wikiApi.setPagePermission({ ...data, resourceId: pageId }),
    onSuccess: () => {
      message.success('已添加权限')
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['wiki', 'page-perms', pageId] })
    },
    onError: (e: any) => message.error(e?.message || '设置失败')
  })

  const revoke = useMutation({
    mutationFn: async (ids: number[]) => {
      // 后端 DELETE /:permissionId 一次一条，本组多条逐个删
      for (const id of ids) {
        await wikiApi.revokePagePermission(id)
      }
    },
    onSuccess: () => {
      message.success('已撤销权限')
      qc.invalidateQueries({ queryKey: ['wiki', 'page-perms', pageId] })
    },
    onError: (e: any) => message.error(e?.message || '撤销失败')
  })

  // 按 user_id / group_id 聚合
  const grouped: Record<string, { key: string; userId?: number; userName?: string; userRealName?: string; groupId?: number; groupName?: string; perms: { id: number; type: string }[] }> = {}
  for (const p of permsData?.data || []) {
    const key = p.user_id ? `u-${p.user_id}` : `g-${p.group_id}`
    if (!grouped[key]) {
      grouped[key] = {
        key,
        userId: p.user_id,
        userName: p.user_name,
        userRealName: p.user_real_name,
        groupId: p.group_id,
        groupName: p.group_name,
        perms: []
      }
    }
    grouped[key].perms.push({ id: p.id, type: p.permission_type })
  }
  const groups = Object.values(grouped)

  // 用户列表（admin 才能拉到）
  const users = usersData?.data?.users || usersData?.data || []
  const userOptions = users.map((u: any) => ({
    value: u.id,
    label: `${u.real_name || u.username}（${u.username}）`
  }))

  return (
    <Modal
      title={`页面权限：${pageTitle || `#${pageId}`}`}
      open={open}
      onCancel={onClose}
      width={680}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {!isAdmin && (
        <Alert
          type="warning"
          showIcon
          message="只有管理员可以修改权限"
          description="若需调整该页面的权限，请联系系统管理员。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="页面级权限会覆盖知识库（空间）级权限"
        description="未在此处设置时，权限继承自知识库；在此处显式授权后，仅对当前页面生效（更严或更宽松均可）。"
      />

      <div style={{ marginBottom: 12 }}>
        <Text strong>已授权 ({groups.length})</Text>
      </div>

      {isLoading ? <Spin /> : groups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有页面级权限（继承自知识库）" />
      ) : (
        <List
          size="small"
          dataSource={groups}
          renderItem={(g) => (
            <List.Item
              actions={[
                isAdmin ? (
                  <Button
                    key="r"
                    icon={<DeleteOutlined />}
                    danger
                    type="link"
                    size="small"
                    onClick={() => Modal.confirm({
                      title: '撤销权限？',
                      content: `将撤销 ${g.userRealName || g.userName || g.groupName} 的全部 ${g.perms.length} 项权限`,
                      onOk: () => revoke.mutate(g.perms.map(p => p.id))
                    })}
                  >撤销</Button>
                ) : null
              ].filter(Boolean) as any}
            >
              <List.Item.Meta
                avatar={<UserOutlined style={{ color: '#0d9488', fontSize: 18 }} />}
                title={
                  <Space>
                    <span>{g.userRealName || g.userName || g.groupName || '未知'}</span>
                    {g.groupId && <Tag color="purple">用户组</Tag>}
                  </Space>
                }
                description={
                  <Space wrap size={4}>
                    {g.perms.map(p => (
                      <Tag key={p.id} color="cyan">
                        {PERMISSION_OPTIONS.find(o => o.value === p.type)?.label || p.type}
                      </Tag>
                    ))}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}

      {isAdmin && (
        <>
          <Divider />
          <Text strong>添加授权</Text>
          <Form
            form={form}
            layout="vertical"
            onFinish={(v) => {
              if (!v.userId) { message.warning('请选择用户'); return }
              if (!v.permissionTypes || v.permissionTypes.length === 0) {
                message.warning('请勾选至少一种权限'); return
              }
              setPerm.mutate({
                userId: v.userId,
                permissionTypes: v.permissionTypes
              })
            }}
            style={{ marginTop: 12 }}
          >
            <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
              <Form.Item name="userId" style={{ marginBottom: 0, flex: 1 }}>
                <Select
                  showSearch
                  placeholder="选择用户"
                  options={userOptions}
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item name="permissionTypes" style={{ marginBottom: 0, flex: 2 }}>
                <Select
                  mode="multiple"
                  placeholder="勾选权限类型"
                  options={PERMISSION_OPTIONS}
                  maxTagCount="responsive"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={setPerm.isPending}
                onClick={() => form.submit()}
              >添加</Button>
            </Space.Compact>
            <Text type="secondary" style={{ fontSize: 12 }}>
              提示：同一用户重复添加会整体替换其在本页面的权限
            </Text>
          </Form>
        </>
      )}
    </Modal>
  )
}
