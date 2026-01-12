import { Drawer, List, Button, Space, Typography, Tag } from 'antd'
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

  const handleViewFile = (file: any) => {
    console.log('点击查看文件 - file:', file)
    const fileId = file?.id || file?.file_id
    console.log('文件ID:', fileId, '类型:', typeof fileId)
    
    if (!fileId) {
      console.error('文件ID无效:', file)
      return
    }
    
    // 确保fileId是数字
    const numericFileId = Number(fileId)
    if (isNaN(numericFileId)) {
      console.error('文件ID不是有效数字:', fileId)
      return
    }
    
    const path = `/files/${numericFileId}`
    console.log('导航到:', path)
    navigate(path)
    // 不关闭弹框，让用户可以选择查看多个文件
  }

  const handleViewAll = () => {
    navigate('/dashboard')
    onClose()
  }

  return (
    <Drawer
      title={
        <Space>
          <FileOutlined />
          <span>文件更新通知</span>
          <Tag color="blue">{files.length} 个新文件</Tag>
        </Space>
      }
      open={visible}
      onClose={onClose}
      placement="right"
      width={500}
      maskClosable={false} // 点击遮罩层不关闭
      closable={true} // 显示关闭按钮
      zIndex={100} // 设置较低的 z-index，确保不会遮挡其他内容
      mask={false} // 移除遮罩层，让用户可以操作其他内容
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button type="primary" onClick={handleViewAll}>
            查看全部
          </Button>
          <Button onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <List
        dataSource={files}
        renderItem={(file: any) => {
          const fileId = file?.id || file?.file_id
          console.log('渲染文件项 - file:', file, 'fileId:', fileId, '类型:', typeof fileId)
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
                    console.log('查看按钮点击 - file:', file)
                    handleViewFile(file)
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
                    <Text strong>{file.original_name || file.name}</Text>
                    {(file.updater_name || file.creator_name) && (
                      <Tag color="green">由 {file.updater_name || file.creator_name} 更新</Tag>
                    )}
                  </Space>
                }
                description={
                  <Space direction="vertical" size="small">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {file.space_name && `空间：${file.space_name}`}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatRelativeTime(file.updated_at || file.created_at)}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )
        }}
      />
    </Drawer>
  )
}
