import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Input, List, Card, Space, Typography, Tag, Empty, Spin, Pagination, Select,
  DatePicker, Breadcrumb
} from 'antd'
import { SearchOutlined, HomeOutlined } from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

const { Title, Text } = Typography

export default function WikiSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [spaceId, setSpaceId] = useState<number | undefined>()
  const [tag, setTag] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [dateRange, setDateRange] = useState<[any, any] | null>(null)

  const { data: spacesData } = useQuery({
    queryKey: ['wiki', 'spaces'],
    queryFn: () => wikiApi.listSpaces()
  })
  const { data: tagsData } = useQuery({
    queryKey: ['wiki', 'tags'],
    queryFn: () => wikiApi.listTags()
  })

  const { data: result, isFetching } = useQuery({
    queryKey: ['wiki', 'search', q, spaceId, tag, page, pageSize, dateRange],
    queryFn: () => wikiApi.search({
      q,
      spaceId,
      tag,
      page,
      pageSize,
      from: dateRange?.[0]?.toISOString(),
      to: dateRange?.[1]?.toISOString()
    }),
    enabled: q.length > 0 || !!spaceId || !!tag
  })

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
          { title: '搜索' }
        ]}
        style={{ marginBottom: 16 }}
      />
      <Title level={3}><SearchOutlined /> 全文搜索</Title>

      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            size="large"
            allowClear
            placeholder="输入关键词搜索（标题或正文）"
            prefix={<SearchOutlined />}
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
          />
          <Space wrap>
            <Select
              allowClear
              placeholder="知识库"
              style={{ minWidth: 200 }}
              value={spaceId}
              onChange={(v) => { setSpaceId(v); setPage(1) }}
              options={(spacesData?.data || []).map((s: any) => ({ value: s.id, label: s.name }))}
            />
            <Select
              allowClear
              placeholder="标签"
              style={{ minWidth: 160 }}
              value={tag}
              onChange={(v) => { setTag(v); setPage(1) }}
              options={(tagsData?.data || []).map((t: any) => ({
                value: t.name, label: `${t.name} (${t.usage_count})`
              }))}
            />
            <DatePicker.RangePicker
              showTime
              onChange={(v: any) => setDateRange(v)}
            />
          </Space>
        </Space>
      </Card>

      {isFetching ? <Spin /> : result?.data && result.data.length > 0 ? (
        <Card>
          <List
            dataSource={result.data}
            renderItem={(r: any) => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/wiki/spaces/${r.space_id}/p/${r.id}`)}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{r.title}</span>
                      <Tag color="cyan">{r.space_name}</Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text>
                        {r.snippet && q ? (
                          highlight(r.snippet, q)
                        ) : r.snippet}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.author_name} · {new Date(r.updated_at).toLocaleDateString('zh-CN')}
                        · {r.view_count} 次浏览
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
          <Pagination
            style={{ marginTop: 16, textAlign: 'right' }}
            current={page}
            pageSize={pageSize}
            total={result.pagination?.total || 0}
            showSizeChanger
            showTotal={(t) => `共 ${t} 条`}
            onChange={(p, ps) => { setPage(p); setPageSize(ps) }}
          />
        </Card>
      ) : q ? (
        <Empty description="无匹配结果" />
      ) : (
        <Empty description="输入关键词或选择筛选条件开始搜索" />
      )}
    </div>
  )
}

function highlight(text: string, q: string) {
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return <>
    {text.slice(0, idx)}
    <mark style={{ background: '#fff1b8', padding: '0 2px' }}>{text.slice(idx, idx + q.length)}</mark>
    {text.slice(idx + q.length)}
  </>
}
