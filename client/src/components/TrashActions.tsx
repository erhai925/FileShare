import { Button, Space, Popconfirm } from 'antd'
import { RollbackOutlined, DeleteOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

interface TrashActionsProps {
  record: any
  onRestore: (id: number) => void
  onPermanentDelete: (id: number) => void
}

export default function TrashActions({ record, onRestore, onPermanentDelete }: TrashActionsProps) {
  const { user } = useAuthStore()
  const perms = record?.user_permissions || {}
  const isAdmin = user?.role === 'admin'
  const isCreator = record?.created_by === user?.id
  const canManage = isAdmin || isCreator || perms.delete

  if (!canManage) return <span style={{ color: '#999' }}>无操作权限</span>

  return (
    <Space>
      <Popconfirm
        title="确定要恢复此文件吗？"
        onConfirm={() => onRestore(record.id)}
      >
        <Button type="link" size="small" icon={<RollbackOutlined />}>
          恢复
        </Button>
      </Popconfirm>
      <Popconfirm
        title="确定要永久删除此文件吗？此操作不可恢复！"
        onConfirm={() => onPermanentDelete(record.id)}
        okType="danger"
      >
        <Button type="link" size="small" danger icon={<DeleteOutlined />}>
          永久删除
        </Button>
      </Popconfirm>
    </Space>
  )
}
