import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Card, Tag, Space, Typography, List, Empty, Spin, Breadcrumb, Row, Col, Input
} from 'antd'
import { TagsOutlined, HomeOutlined, SearchOutlined } from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

const { Title, Text } = Typography

export default function WikiTags() {
  const navigate = useNavigate()
  const [selectedTag, setSelectedTag] = useState<{ id: number; name: string } | null>(null)
  const [filter, setFilter] = useState('')

  const { data: tagsData, isLoading } = useQuery({
    queryKey: ['wiki', 'tags'],
    queryFn: () => wikiApi.listTags()
  })

  const { data: pagesData } = useQuery({
    queryKey: ['wiki', 'tag-pages', selectedTag?.id],
    queryFn: () => wikiApi.getTagPages(selectedTag!.id),
    enabled: !!selectedTag
  })

  const tags = (tagsData?.data || []).filter((t: any) =>
    !filter || t.name.toLowerCase().includes(filter.toLowerCase())
  )

  // 计算字号：使用次数越多字号越大（最小 12 / 最大 22）
  const maxCount = Math.max(1, ...tags.map((t: any) => t.usage_count || 0))
  const fontSizeFor = (count: number) => 12 + Math.round(((count || 0) / maxCount) * 10)

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
          { title: '标签' }
        ]}
        style={{ marginBottom: 16 }}
      />
      <Title level={3}><TagsOutlined /> 标签</Title>

      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card
            title={`全部标签 (${tags.length})`}
            extra={
              <Input
                size="small"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="过滤"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                style={{ width: 160 }}
              />
            }
          >
            {isLoading ? <Spin /> : tags.length === 0 ? (
              <Empty description="还没有标签" />
            ) : (
              <Space wrap size={[6, 12]}>
                {tags.map((t: any) => (
                  <Tag
                    key={t.id}
                    color={selectedTag?.id === t.id ? t.color || 'cyan' : undefined}
                    style={{
                      fontSize: fontSizeFor(t.usage_count),
                      padding: '4px 10px',
                      cursor: 'pointer',
                      border: selectedTag?.id === t.id
                        ? `1px solid ${t.color || '#0d9488'}`
                        : undefined
                    }}
                    onClick={() => setSelectedTag({ id: t.id, name: t.name })}
                  >
                    {t.name} <Text type="secondary" style={{ fontSize: 11 }}>×{t.usage_count}</Text>
                  </Tag>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title={selectedTag ? `「${selectedTag.name}」 的页面` : '选择左侧标签'}>
            {!selectedTag ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧标签查看相关页面" />
            ) : pagesData?.data?.length ? (
              <List
                dataSource={pagesData.data}
                renderItem={(p: any) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/wiki/spaces/${p.space_id}/p/${p.id}`)}
                  >
                    <List.Item.Meta
                      title={p.title}
                      description={
                        <Space>
                          <Tag color="cyan">{p.space_name}</Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(p.updated_at).toLocaleDateString('zh-CN')}
                          </Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="该标签下暂无页面" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
