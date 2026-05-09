import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button, Card, Col, Row, Space, Typography, Modal, Form, Input, Select,
  Empty, Tag, Spin, message, List
} from 'antd'
import {
  PlusOutlined, BookOutlined, StarFilled, FireOutlined, HistoryOutlined,
  TeamOutlined, UserOutlined, FolderOpenOutlined, SearchOutlined,
  TagsOutlined, BellOutlined, DeleteOutlined
} from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

const { Title, Text } = Typography

const SPACE_TYPE_LABEL: Record<string, string> = {
  team: '团队',
  department: '部门',
  personal: '个人',
  project: '项目'
}

export default function WikiHome() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

  const { data: spacesData, isLoading: spacesLoading } = useQuery({
    queryKey: ['wiki', 'spaces'],
    queryFn: () => wikiApi.listSpaces()
  })
  const { data: favData } = useQuery({
    queryKey: ['wiki', 'favorites'],
    queryFn: () => wikiApi.listFavorites()
  })
  const { data: popData } = useQuery({
    queryKey: ['wiki', 'popular'],
    queryFn: () => wikiApi.popular(undefined, 10)
  })
  const { data: recentData } = useQuery({
    queryKey: ['wiki', 'recent'],
    queryFn: () => wikiApi.recent()
  })

  const createSpace = useMutation({
    mutationFn: (v: any) => wikiApi.createSpace(v),
    onSuccess: () => {
      message.success('知识库创建成功')
      setCreateOpen(false)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['wiki', 'spaces'] })
    },
    onError: (e: any) => message.error(e?.message || '创建失败')
  })

  const spaces = spacesData?.data || []

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Title level={3} style={{ margin: 0 }}>
          <BookOutlined /> Wiki 知识库
        </Title>
        <Space>
          <Button icon={<SearchOutlined />} onClick={() => navigate('/wiki/search')}>搜索</Button>
          <Button icon={<TagsOutlined />} onClick={() => navigate('/wiki/tags')}>标签</Button>
          <Button icon={<BellOutlined />} onClick={() => navigate('/wiki/subscriptions')}>订阅</Button>
          <Button icon={<DeleteOutlined />} onClick={() => navigate('/wiki/trash')}>回收站</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建知识库
          </Button>
        </Space>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="我的知识库">
            {spacesLoading ? <Spin /> : spaces.length === 0 ? (
              <Empty description="暂无知识库，新建一个开始沉淀团队经验" />
            ) : (
              <Row gutter={[12, 12]}>
                {spaces.map((s: any) => (
                  <Col xs={24} sm={12} key={s.id}>
                    <Card
                      hoverable
                      onClick={() => navigate(`/wiki/spaces/${s.id}`)}
                      size="small"
                    >
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space>
                          <FolderOpenOutlined style={{ color: '#0d9488' }} />
                          <strong>{s.name}</strong>
                          <Tag color="cyan">{SPACE_TYPE_LABEL[s.type] || s.type}</Tag>
                        </Space>
                        {s.description && <Text type="secondary" ellipsis>{s.description}</Text>}
                        <Space size="middle">
                          <Text type="secondary"><BookOutlined /> {s.page_count || 0} 页</Text>
                          {s.last_updated_at && (
                            <Text type="secondary">{new Date(s.last_updated_at).toLocaleDateString('zh-CN')}</Text>
                          )}
                        </Space>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title={<Space><StarFilled style={{ color: '#faad14' }} /> 我的收藏</Space>} size="small">
              {favData?.data?.length ? (
                <List
                  size="small"
                  dataSource={favData.data}
                  renderItem={(p: any) => (
                    <List.Item
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/wiki/spaces/${p.space_id}/p/${p.id}`)}
                    >
                      <Space direction="vertical" size={0}>
                        <span>{p.title}</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>{p.space_name}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无收藏" />}
            </Card>

            <Card title={<Space><FireOutlined style={{ color: '#f5222d' }} /> 热门页面</Space>} size="small">
              {popData?.data?.length ? (
                <List
                  size="small"
                  dataSource={popData.data}
                  renderItem={(p: any) => (
                    <List.Item
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/wiki/spaces/${p.space_id}/p/${p.id}`)}
                    >
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <span>{p.title}</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {p.space_name} · 近 30 天 {p.recent_views} 次查看
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无热门" />}
            </Card>

            <Card title={<Space><HistoryOutlined /> 最近浏览</Space>} size="small">
              {recentData?.data?.length ? (
                <List
                  size="small"
                  dataSource={recentData.data}
                  renderItem={(p: any) => (
                    <List.Item
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/wiki/spaces/${p.space_id}/p/${p.id}`)}
                    >
                      <Space direction="vertical" size={0}>
                        <span>{p.title}</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {p.space_name}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无浏览记录" />}
            </Card>
          </Space>
        </Col>
      </Row>

      <Modal
        title="新建知识库"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createSpace.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createSpace.mutate(v)}
          initialValues={{ type: 'team' }}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入知识库名称' }]}>
            <Input placeholder="例如：运维故障经验库" />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'team', label: <><TeamOutlined /> 团队</> },
                { value: 'department', label: <><TeamOutlined /> 部门</> },
                { value: 'personal', label: <><UserOutlined /> 个人</> },
                { value: 'project', label: <><BookOutlined /> 项目</> }
              ]}
            />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="（可选）这个知识库主要沉淀什么内容" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
