import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card, List, Button, Space, Typography, Tag, Empty, Spin, message, Breadcrumb
} from 'antd'
import { BellOutlined, HomeOutlined, DeleteOutlined, FileTextOutlined, BookOutlined, TagOutlined } from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

const { Title, Text } = Typography

const TYPE_LABEL = { page: '页面', space: '知识库', tag: '标签' } as const

export default function WikiSubscriptions() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'subscriptions'],
    queryFn: () => wikiApi.listSubscriptions()
  })

  const unsubscribe = useMutation({
    mutationFn: (id: number) => wikiApi.unsubscribe(id),
    onSuccess: () => {
      message.success('已取消订阅')
      qc.invalidateQueries({ queryKey: ['wiki', 'subscriptions'] })
    },
    onError: (e: any) => message.error(e?.message || '取消订阅失败')
  })

  const items = data?.data || []
  // 分组
  const groups = {
    page: items.filter((i: any) => i.target_type === 'page'),
    space: items.filter((i: any) => i.target_type === 'space'),
    tag: items.filter((i: any) => i.target_type === 'tag')
  }

  const iconFor = (type: string) =>
    type === 'page' ? <FileTextOutlined /> :
    type === 'space' ? <BookOutlined /> : <TagOutlined />

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
          { title: '我的订阅' }
        ]}
        style={{ marginBottom: 16 }}
      />
      <Title level={3}><BellOutlined /> 我的订阅</Title>
      <Text type="secondary">订阅的页面 / 知识库 / 标签有更新时会通知你</Text>

      {isLoading ? <Spin /> : items.length === 0 ? (
        <Card style={{ marginTop: 16 }}>
          <Empty description="还没有订阅。在页面或知识库右上角点「订阅」按钮即可关注更新" />
        </Card>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
          {(['page', 'space', 'tag'] as const).map(type => (
            groups[type].length > 0 && (
              <Card
                key={type}
                size="small"
                title={<Space>{iconFor(type)}<span>{TYPE_LABEL[type]} ({groups[type].length})</span></Space>}
              >
                <List
                  dataSource={groups[type]}
                  renderItem={(s: any) => (
                    <List.Item
                      actions={[
                        <Button
                          key="u"
                          icon={<DeleteOutlined />}
                          danger
                          size="small"
                          type="link"
                          onClick={() => unsubscribe.mutate(s.id)}
                        >取消</Button>
                      ]}
                    >
                      <Space>
                        <Tag>#{s.target_id}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          订阅于 {new Date(s.created_at).toLocaleDateString('zh-CN')}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            )
          ))}
        </Space>
      )}
    </div>
  )
}
