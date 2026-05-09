import { Modal, Space, Typography, Button, Alert } from 'antd'

const { Text } = Typography

export interface ConflictData {
  currentVersion: number
  currentTitle: string
  currentContent: string
  updatedBy: number
  updatedAt: string
}

interface Props {
  open: boolean
  data: ConflictData | null
  onCancel: () => void
  onOverwrite: () => void
  onDiscard: () => void
}

/**
 * F15 冲突对话框：保存时返回 409 后弹出，提供：
 * - 强制覆盖：以本地内容生成更高版本
 * - 丢弃我的修改：用服务器最新内容刷新编辑器
 * - 取消：留在当前对话框，自行处理
 */
export default function ConflictDialog({ open, data, onCancel, onOverwrite, onDiscard }: Props) {
  return (
    <Modal
      title="保存冲突"
      open={open}
      onCancel={onCancel}
      width={720}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={onDiscard}>丢弃我的修改（载入服务器最新版）</Button>
          <Button danger type="primary" onClick={onOverwrite}>
            强制覆盖（保留我的修改）
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        message="页面已被他人更新"
        description={
          <span>
            当前服务器版本：v{data?.currentVersion}，更新于{' '}
            {data?.updatedAt && new Date(data.updatedAt).toLocaleString('zh-CN')}。
            请选择如何处理你的修改。
          </span>
        }
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 8 }}>
        <Text strong>服务器最新内容预览：</Text>
      </div>
      <div style={{
        background: '#fafafa',
        border: '1px solid #eee',
        padding: 12,
        borderRadius: 4,
        maxHeight: 300,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12
      }}>
        {data?.currentContent || '(空)'}
      </div>
    </Modal>
  )
}
