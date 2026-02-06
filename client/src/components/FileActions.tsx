import { Button, Space, Popconfirm } from 'antd'
import { FileTextOutlined, EyeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export interface FileActionsProps {
  record: any
  onPreview?: (record: any) => void
  onDownload?: (id: number, name: string) => void
  onRename?: (record: any) => void
  onMove?: (record: any) => void
  onRemoveFromSpace?: (id: number) => void
  onDelete?: (id: number) => void
  showDetail?: boolean
  showPreview?: boolean
  showDownload?: boolean
  showRename?: boolean
  showMove?: boolean
  showRemoveFromSpace?: boolean
  showDelete?: boolean
}

export default function FileActions({
  record,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onRemoveFromSpace,
  onDelete,
  showDetail = true,
  showPreview = true,
  showDownload = true,
  showRename = true,
  showMove = true,
  showRemoveFromSpace = true,
  showDelete = true
}: FileActionsProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const perms = record?.user_permissions || {}
  const isAdmin = user?.role === 'admin'
  const isCreator = record?.created_by === user?.id

  const canRead = isAdmin || isCreator || perms.read
  const canDownload = isAdmin || isCreator || perms.download
  const canWrite = isAdmin || isCreator || perms.write
  const canDelete = isAdmin || isCreator || perms.delete

  return (
    <Space>
      {showDetail && canRead && (
        <Button
          type="link"
          size="small"
          icon={<FileTextOutlined />}
          onClick={() => navigate(`/files/${record.id}`)}
        >
          详情
        </Button>
      )}
      {showPreview && canRead && onPreview && (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => onPreview(record)}
        >
          预览
        </Button>
      )}
      {showDownload && canDownload && onDownload && (
        <Button
          type="link"
          size="small"
          onClick={() => onDownload(record.id, record.original_name)}
        >
          下载
        </Button>
      )}
      {showRename && canWrite && onRename && (
        <Button
          type="link"
          size="small"
          onClick={() => onRename(record)}
        >
          重命名
        </Button>
      )}
      {showMove && canWrite && onMove && (
        <Button
          type="link"
          size="small"
          onClick={() => onMove(record)}
        >
          移动
        </Button>
      )}
      {showRemoveFromSpace && canWrite && record?.space_id && onRemoveFromSpace && (
        <Button
          type="link"
          size="small"
          onClick={() => onRemoveFromSpace(record.id)}
        >
          从空间移除
        </Button>
      )}
      {showDelete && canDelete && onDelete && (
        <Popconfirm
          title="确定要删除此文件吗？"
          description="文件将被移至回收站，可在回收站中恢复或永久删除"
          onConfirm={() => onDelete(record.id)}
          okText="确定"
          cancelText="取消"
          okType="danger"
        >
          <Button type="link" size="small" danger>
            删除
          </Button>
        </Popconfirm>
      )}
    </Space>
  )
}
