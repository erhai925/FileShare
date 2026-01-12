import { Modal, List, Button, Space, Typography, Tag } from 'antd'
import { FileOutlined, EyeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

// 格式化相对时间
function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const target = new Date(date)
  const diff = now.getTime() - target.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days} 天前`
  } else if (hours > 0) {
    return `${hours} 小时前`
  } else if (minutes > 0) {
    return `${minutes} 分钟前`
  } else {
    return '刚刚'
  }
}

interface FileUpdateNotificationProps {
  visible: boolean
  files: any[]
  onClose: () => void
}

export default function FileUpdateNotification({ visible, files, onClose }: FileUpdateNotificationProps) {
  const navigate = useNavigate()

  const handleViewFile = (fileId: number) => {
    console.log('点击查看文件 - fileId:', fileId, '类型:', typeof fileId)
    if (!fileId) {
      console.error('文件ID无效:', fileId)
      return
    }
    const path = `/files/${fileId}`
    console.log('导航到:', path)
    navigate(path)
    onClose()
  }

  const handleViewAll = () => {
    navigate('/dashboard')
    onClose()
  }

  return (
    <Modal
      title={
        <Space>
          <FileOutlined />
          <span>文件更新通知</span>
          <Tag color="blue">{files.length} 个新文件</Tag>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="view-all" type="primary" onClick={handleViewAll}>
          查看全部
        </Button>,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>
      ]}
      width={600}
    >
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <List
          dataSource={files}
          renderItem={(file: any) => {
            console.log('渲染文件项 - file:', file, 'file.id:', file.id, '类型:', typeof file.id)
            return (
              <List.Item
                actions={[
                  <Button
                    key="view"
                    type="link"
                    icon={<EyeOutlined />}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      console.log('查看按钮点击 - file:', file, 'file.id:', file.id)
                      if (file && file.id) {
                        handleViewFile(Number(file.id))
                      } else {
                        console.error('文件ID无效:', file)
                      }
                    }}
                  >
                    查看
                  </Button>
                ]}
              >
              <List.Item.Meta
                avatar={<FileOutlined style={{ fontSize: 20 }} />}
                title={
                  <Space>
                    <Text strong>{file.original_name}</Text>
                    {file.updater_name && (
                      <Tag color="green">由 {file.updater_name} 更新</Tag>
                    )}
                  </Space>
                }
                description={
                  <Space direction="vertical" size="small">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {file.space_name && `空间：${file.space_name}`}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatRelativeTime(file.updated_at)}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
            )
          }}
        />
      </div>
    </Modal>
  )
}
