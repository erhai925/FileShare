import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Statistic, List, Typography, Space } from 'antd'
import {
  FileOutlined,
  FolderOutlined,
  TeamOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  TrophyOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'
import { formatDateTime } from '../utils/date'
import './Dashboard.css'

const { Title } = Typography

const RECENT_PAGE_SIZE_OPTIONS = [10, 50, 100]

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [recentPage, setRecentPage] = useState(1)
  const [recentPageSize, setRecentPageSize] = useState(10)
  
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
    queryKey: ['files', 'recent', recentPage, recentPageSize],
    queryFn: () => api.get('/files/list', { params: { page: recentPage, pageSize: recentPageSize } })
  })

  // 获取最近一周的新文件（包括新上传和更新的，用于标记）
  const { data: recentFiles } = useQuery({
    queryKey: ['files', 'recent-files'],
    queryFn: () => api.get('/files/recent-files')
  })

  // 系统版本号（使用 /api/version 接口）
  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get('version')
  })

  // 上传文件最多的前5名用户（排除 admin）
  const { data: topUploadersData } = useQuery({
    queryKey: ['files', 'top-uploaders'],
    queryFn: () => api.get('/files/top-uploaders')
  })

  // 下载次数最多的前5个文件
  const { data: topDownloadsData } = useQuery({
    queryKey: ['files', 'top-downloads'],
    queryFn: () => api.get('/files/top-downloads')
  })

  // 下载操作最多的前5名用户（排除 admin）
  const { data: topDownloadersData } = useQuery({
    queryKey: ['files', 'top-downloaders'],
    queryFn: () => api.get('/files/top-downloaders')
  })

  // 判断文件是否为最近一周的新文件
  const isRecentlyNew = (fileId: number) => {
    if (!recentFiles?.data?.files) return false
    return recentFiles.data.files.some((f: any) => f.id === fileId)
  }
  

  const version = (versionData as { version?: string })?.version || '-'
  const topUploaders = topUploadersData?.data?.list || []
  const topDownloads = topDownloadsData?.data?.list || []
  const topDownloaders = topDownloadersData?.data?.list || []

  return (
    <div className="dashboard-page">
      <Title level={2} className="dashboard-title">
        工作台
        {user && (
          <span style={{ fontSize: 16, fontWeight: 'normal', color: 'var(--text-secondary)', marginLeft: 12 }}>
            欢迎，{user.realName || user.username}
          </span>
        )}
        <span style={{ fontSize: 14, fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: 12 }}>
          <InfoCircleOutlined /> 系统版本 v{version}
        </span>
      </Title>
      
      <Row gutter={16} className="dashboard-stats" style={{ marginBottom: 24 }}>
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

      {(topUploaders.length > 0 || topDownloaders.length > 0) && (
        <Row gutter={16} className="dashboard-section" style={{ marginBottom: 24 }}>
          {topUploaders.length > 0 && (
            <Col span={12}>
              <Card
                title={
                  <Space>
                    <TrophyOutlined />
                    用户上传排行榜（前5名）
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
          )}
          {topDownloaders.length > 0 && (
            <Col span={12}>
              <Card
                title={
                  <Space>
                    <DownloadOutlined />
                    用户下载排行榜（前5名）
                  </Space>
                }
              >
                <List
                  size="small"
                  dataSource={topDownloaders}
                  renderItem={(item: any, index: number) => (
                    <List.Item>
                      <Space>
                        <span style={{ color: '#faad14', fontWeight: 'bold', minWidth: 20 }}>
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                        </span>
                        <span>{item.realName}</span>
                        <span style={{ color: '#999' }}>下载 {item.downloadCount} 次</span>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          )}
        </Row>
      )}

      {topDownloads.length > 0 && (
        <Row gutter={16} className="dashboard-section" style={{ marginBottom: 24 }}>
          <Col span={24}>
            <Card
              title={
                <Space>
                  <DownloadOutlined />
                  文件下载排行榜（前5名）
                </Space>
              }
            >
              <List
                size="small"
                dataSource={topDownloads}
                renderItem={(item: any, index: number) => (
                  <List.Item>
                    <Space>
                      <span style={{ color: '#faad14', fontWeight: 'bold', minWidth: 20 }}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                      </span>
                      <a
                        href={`/files/${item.id}`}
                        onClick={(e) => {
                          e.preventDefault()
                          navigate(`/files/${item.id}`)
                        }}
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {item.original_name}
                      </a>
                      <span style={{ color: '#999' }}>下载 {item.download_count} 次</span>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Card title="最近文件" className="dashboard-section">
        <div className="dashboard-recent-files-list-wrap">
        <List
          dataSource={recentFilesList?.data?.files || []}
          pagination={{
            current: recentPage,
            pageSize: recentPageSize,
            total: recentFilesList?.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: RECENT_PAGE_SIZE_OPTIONS,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, size) => {
              setRecentPage(p)
              setRecentPageSize(size || 10)
            }
          }}
          renderItem={(item: any) => {
            const isNew = isRecentlyNew(item.id)
            const spaceLink = item.space_id ? (
              <a
                href={`/spaces/${item.space_id}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/spaces/${item.space_id}`)
                }}
                style={{ color: 'var(--color-accent)', marginRight: 8 }}
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
                style={{ color: 'var(--color-accent)' }}
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
                        style={{ color: 'var(--color-accent)' }}
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
        </div>
      </Card>
    </div>
  )
}

