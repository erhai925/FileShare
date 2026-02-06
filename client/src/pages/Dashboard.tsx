import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Statistic, List, Typography, Button, Space, Tag, message } from 'antd'
import {
  FileOutlined,
  FolderOutlined,
  TeamOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  WindowsOutlined,
  AppleOutlined,
  TrophyOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'
import { formatDateTime } from '../utils/date'

const { Title } = Typography

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  
  const { data: stats } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get('/admin/stats'),
    enabled: isAdmin // 只有管理员才查询系统统计
  })
  
  // 获取用户自己的统计（非管理员）
  const { data: userStats } = useQuery({
    queryKey: ['user', 'stats', user?.id],
    queryFn: async () => {
      try {
        // 获取用户自己的文件统计（包含总数和存储大小）
        const filesRes = await api.get('/files/list', { params: { page: 1, pageSize: 1000 } })
        const filesTotal = filesRes.data?.total || 0
        let userStorageSize = 0
        if (filesRes.data?.files) {
          userStorageSize = filesRes.data.files.reduce((sum: number, file: any) => sum + (file.file_size || 0), 0)
        }
        
        // 获取用户自己的空间数
        const spacesRes = await api.get('/spaces')
        const spacesTotal = spacesRes.data?.data?.length || 0
        
        return {
          success: true,
          data: {
            files: { total: filesTotal },
            spaces: { total: spacesTotal },
            storage: {
              used_gb: parseFloat((userStorageSize / 1024 / 1024 / 1024).toFixed(2))
            }
          }
        }
      } catch (error) {
        console.error('获取用户统计失败:', error)
        return {
          success: true,
          data: {
            files: { total: 0 },
            spaces: { total: 0 },
            storage: { used_gb: 0 }
          }
        }
      }
    },
    enabled: !isAdmin && !!user?.id
  })
  
  // 根据用户角色选择统计数据
  const displayStats = isAdmin ? stats : userStats

  const { data: recentFilesList } = useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () => api.get('/files/list', { params: { page: 1, pageSize: 10 } })
  })

  // 获取最近一周的新文件（包括新上传和更新的，用于标记）
  const { data: recentFiles } = useQuery({
    queryKey: ['files', 'recent-files'],
    queryFn: () => api.get('/files/recent-files')
  })

  // 系统版本号
  const { data: healthData } = useQuery({
    queryKey: ['health', 'version'],
    queryFn: () => api.get('health')
  })

  // 上传文件最多的前5名用户（排除 admin）
  const { data: topUploadersData } = useQuery({
    queryKey: ['files', 'top-uploaders'],
    queryFn: () => api.get('/files/top-uploaders')
  })

  // 判断文件是否为最近一周的新文件
  const isRecentlyNew = (fileId: number) => {
    if (!recentFiles?.data?.files) return false
    return recentFiles.data.files.some((f: any) => f.id === fileId)
  }
  

  // 处理下载
  const handleDownload = async (platform: 'mac' | 'win' | 'linux') => {
    const fileMap = {
      mac: { name: 'FileShare.dmg', displayName: 'macOS 版本' },
      win: { name: 'FileShare-Setup.exe', displayName: 'Windows 版本' },
      linux: { name: 'FileShare.AppImage', displayName: 'Linux 版本' }
    }
    
    const fileInfo = fileMap[platform]
    const downloadUrl = `/api/downloads/${fileInfo.name}`
    
    try {
      // 先检查文件是否存在
      const response = await fetch(downloadUrl, { method: 'HEAD' })
      if (!response.ok) {
        message.warning(`${fileInfo.displayName} 暂未提供，请先构建安装程序。`)
        return
      }
      
      // 创建临时链接进行下载
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = fileInfo.name
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      message.success(`正在下载 ${fileInfo.displayName}...`)
    } catch (error) {
      console.error('下载失败:', error)
      message.error(`下载 ${fileInfo.displayName} 失败，请稍后重试或联系管理员。`)
    }
  }

  const version = (healthData as { version?: string })?.version || '-'
  const topUploaders = topUploadersData?.data?.list || []

  return (
    <div>
      <Title level={2}>
        工作台
        {user && (
          <span style={{ fontSize: 16, fontWeight: 'normal', color: '#666', marginLeft: 12 }}>
            欢迎，{user.realName || user.username}
          </span>
        )}
        <span style={{ fontSize: 14, fontWeight: 'normal', color: '#999', marginLeft: 12 }}>
          <InfoCircleOutlined /> 系统版本 v{version}
        </span>
      </Title>
      
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title={isAdmin ? "文件总数" : "我的文件"}
              value={displayStats?.data?.files?.total || 0}
              prefix={<FileOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={isAdmin ? "存储空间" : "我的存储"}
              value={displayStats?.data?.storage?.used_gb || 0}
              suffix="GB"
              prefix={<CloudUploadOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={isAdmin ? "空间数量" : "我的空间"}
              value={displayStats?.data?.spaces?.total || 0}
              prefix={<FolderOutlined />}
            />
          </Card>
        </Col>
        {isAdmin && (
          <Col span={6}>
            <Card>
              <Statistic
                title="用户数量"
                value={displayStats?.data?.users?.total || 0}
                prefix={<TeamOutlined />}
              />
            </Card>
          </Col>
        )}
      </Row>

      {topUploaders.length > 0 && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={24}>
            <Card
              title={
                <Space>
                  <TrophyOutlined />
                  上传排行榜（前5名）
                </Space>
              }
            >
              <List
                size="small"
                dataSource={topUploaders}
                renderItem={(item: any, index: number) => (
                  <List.Item>
                    <Space>
                      <span style={{ color: '#faad14', fontWeight: 'bold', minWidth: 20 }}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                      </span>
                      <span>{item.realName}</span>
                      <span style={{ color: '#999' }}>上传 {item.uploadCount} 个文件</span>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card 
            title={
              <Space>
                <DownloadOutlined />
                桌面客户端
              </Space>
            }
            extra={<Tag color="blue">推荐</Tag>}
          >
            <div style={{ marginBottom: 16 }}>
              <Typography.Paragraph>
                下载桌面客户端，享受更好的文件管理体验。支持拖拽上传、本地文件选择、系统托盘等功能。
              </Typography.Paragraph>
            </div>
            <Space size="large" wrap>
              <Button
                type="primary"
                size="large"
                icon={<AppleOutlined />}
                onClick={() => handleDownload('mac')}
              >
                下载 macOS 版本
              </Button>
              <Button
                type="primary"
                size="large"
                icon={<WindowsOutlined />}
                onClick={() => handleDownload('win')}
              >
                下载 Windows 版本
              </Button>
            </Space>
            <div style={{ marginTop: 16, padding: 12, backgroundColor: '#f0f0f0', borderRadius: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                💡 提示：如果下载链接不可用，请先运行 <code>npm run electron:build</code> 构建安装程序。
                构建完成后，安装程序将位于 <code>dist-electron</code> 目录中，请将其复制到 <code>downloads</code> 目录。
              </Typography.Text>
            </div>
          </Card>
        </Col>
      </Row>

      <Card title="最近文件">
        <List
          dataSource={recentFilesList?.data?.files || []}
          renderItem={(item: any) => {
            const isNew = isRecentlyNew(item.id)
            const spaceLink = item.space_id ? (
              <a
                href={`/spaces/${item.space_id}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/spaces/${item.space_id}`)
                }}
                style={{ color: '#1890ff', marginRight: 8 }}
              >
                {item.space_name || '未命名空间'}
              </a>
            ) : (
              <span style={{ color: '#999', marginRight: 8 }}>未分类</span>
            )
            const folderLink = item.folder_id && item.folder_name ? (
              <a
                href={`/spaces/${item.space_id}?folderId=${item.folder_id}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/spaces/${item.space_id}?folderId=${item.folder_id}`)
                }}
                style={{ color: '#1890ff' }}
              >
                {item.folder_name}
              </a>
            ) : item.space_id ? (
              <span style={{ color: '#999' }}>根目录</span>
            ) : null
            return (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      {isNew && (
                        <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>[新]</span>
                      )}
                      <a
                        href={`/files/${item.id}`}
                        onClick={(e) => {
                          e.preventDefault()
                          navigate(`/files/${item.id}`)
                        }}
                        style={{ color: '#1890ff' }}
                      >
                        {item.original_name}
                      </a>
                    </Space>
                  }
                  description={
                    <Space split={<span style={{ color: '#d9d9d9' }}>•</span>}>
                      {item.space_id ? (
                        <>
                          <span>空间：{spaceLink}</span>
                          {item.folder_id ? <span>文件夹：{folderLink}</span> : <span>根目录</span>}
                        </>
                      ) : (
                        <span style={{ color: '#999' }}>未分类</span>
                      )}
                      <span>{item.creator_name}</span>
                      <span>{formatDateTime(item.created_at)}</span>
                    </Space>
                  }
                />
              </List.Item>
            )
          }}
        />
      </Card>
    </div>
  )
}

