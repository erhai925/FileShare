import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Statistic, List, Typography, Button, Space, Tag, message } from 'antd'
import {
  FileOutlined,
  FolderOutlined,
  TeamOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  WindowsOutlined,
  AppleOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'

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

  // 判断文件是否为最近一周的新文件
  const isRecentlyNew = (fileId: number) => {
    if (!recentFiles?.data?.files) {
      console.log('新文件标识检查 - 没有文件数据');
      return false;
    }
    const isNew = recentFiles.data.files.some((f: any) => f.id === fileId);
    if (isNew) {
      console.log('新文件标识检查 - 文件', fileId, '是新文件');
    }
    return isNew;
  }
  
  // 调试信息
  useEffect(() => {
    console.log('工作台 - recentFilesList:', recentFilesList);
    console.log('工作台 - recentFiles:', recentFiles);
    if (recentFiles?.data?.files) {
      console.log('工作台 - 新文件列表:', recentFiles.data.files);
    }
  }, [recentFilesList, recentFiles])

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

  return (
    <div>
      <Title level={2}>工作台</Title>
      
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
                  description={`${item.creator_name} • ${new Date(item.created_at).toLocaleString()}`}
                />
              </List.Item>
            )
          }}
        />
      </Card>
    </div>
  )
}

