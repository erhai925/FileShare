import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge, Dropdown, List, Button, Empty, Space, Typography, Tag, Spin } from 'antd'
import {
  BellOutlined, BellFilled, FileTextOutlined, CommentOutlined
} from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

const { Text } = Typography

const TYPE_LABEL: Record<string, { text: string; icon: any; color: string }> = {
  mention: { text: '@ 提及', icon: <CommentOutlined />, color: '#fa8c16' },
  subscription_update: { text: '订阅更新', icon: <FileTextOutlined />, color: '#0d9488' }
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  // 30s 轮询未读数（轻量端点）
  const { data: countData } = useQuery({
    queryKey: ['wiki', 'notify-count'],
    queryFn: () => wikiApi.notifyUnreadCount(),
    refetchInterval: 30000,
    refetchIntervalInBackground: false
  })

  // 仅在打开时拉取详细列表
  const { data: listData, isFetching } = useQuery({
    queryKey: ['wiki', 'notify-list'],
    queryFn: () => wikiApi.notifications(),
    enabled: open
  })

  const markRead = useMutation({
    mutationFn: (id: number) => wikiApi.markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'notify-count'] })
      qc.invalidateQueries({ queryKey: ['wiki', 'notify-list'] })
    }
  })
  const markAll = useMutation({
    mutationFn: () => wikiApi.markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'notify-count'] })
      qc.invalidateQueries({ queryKey: ['wiki', 'notify-list'] })
    }
  })

  const count = countData?.data?.count || 0
  const items = listData?.data || []

  const handleClick = (n: any) => {
    if (!n.read_at) markRead.mutate(n.id)
    setOpen(false)
    if (n.target_type === 'page' && n.page_space_id) {
      navigate(`/wiki/spaces/${n.page_space_id}/p/${n.target_id}`)
    }
  }

  const dropdownContent = (
    <div style={{
      width: 380,
      maxHeight: 480,
      background: '#fff',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Text strong>通知 {count > 0 && <Tag color="red">{count}</Tag>}</Text>
        {count > 0 && (
          <Button size="small" type="link" onClick={() => markAll.mutate()} loading={markAll.isPending}>
            全部已读
          </Button>
        )}
      </div>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {isFetching ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
        ) : items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" style={{ padding: 24 }} />
        ) : (
          <List
            size="small"
            dataSource={items}
            renderItem={(n: any) => {
              const meta = TYPE_LABEL[n.type] || { text: n.type, icon: <BellOutlined />, color: '#888' }
              return (
                <List.Item
                  onClick={() => handleClick(n)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 14px',
                    background: n.read_at ? '#fff' : '#fffbe6'
                  }}
                >
                  <Space align="start" size={8} style={{ width: '100%' }}>
                    <span style={{ color: meta.color, fontSize: 16 }}>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>
                        <Text strong style={{ color: meta.color }}>{meta.text}</Text>
                        <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                          {n.actor_real_name || n.actor_name || '系统'}
                        </Text>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 2 }}>
                        {n.type === 'mention' ? '在评论中提到了你 · ' : '更新了 · '}
                        <Text>{n.page_title || n.payload?.title || `#${n.target_id}`}</Text>
                      </div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(n.created_at).toLocaleString('zh-CN')}
                      </Text>
                    </div>
                    {!n.read_at && (
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: '#f5222d', marginTop: 6 }} />
                    )}
                  </Space>
                </List.Item>
              )
            }}
          />
        )}
      </div>
      <div style={{ padding: 8, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
        <Button type="link" size="small" onClick={() => { setOpen(false); navigate('/wiki/subscriptions') }}>
          管理订阅
        </Button>
      </div>
    </div>
  )

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="bottomRight"
      dropdownRender={() => dropdownContent}
    >
      <Badge count={count} size="small" offset={[-2, 4]}>
        <Button
          type="text"
          shape="circle"
          icon={count > 0 ? <BellFilled style={{ color: '#fa8c16' }} /> : <BellOutlined />}
        />
      </Badge>
    </Dropdown>
  )
}
