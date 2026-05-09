import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, List, Button, Space, Typography, Tag, Empty, message, Modal, Breadcrumb } from 'antd'
import { DeleteOutlined, RollbackOutlined, HomeOutlined } from '@ant-design/icons'
import { wikiApi } from '../../services/wikiService'

const { Title, Text } = Typography

export default function WikiTrash() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'trash'],
    queryFn: () => wikiApi.trash()
  })

  const restore = useMutation({
    mutationFn: (id: number) => wikiApi.restorePage(id),
    onSuccess: () => {
      message.success('已恢复')
      qc.invalidateQueries({ queryKey: ['wiki', 'trash'] })
    },
    onError: (e: any) => message.error(e?.message || '恢复失败')
  })
  const purge = useMutation({
    mutationFn: (id: number) => wikiApi.permanentDeletePage(id),
    onSuccess: () => {
      message.success('已彻底删除')
      qc.invalidateQueries({ queryKey: ['wiki', 'trash'] })
    },
    onError: (e: any) => message.error(e?.message || '删除失败')
  })

  return (
    <div style={{ padding: 24 }}>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/wiki')}><HomeOutlined /> Wiki</a> },
          { title: '回收站' }
        ]}
        style={{ marginBottom: 16 }}
      />
      <Title level={3}><DeleteOutlined /> Wiki 回收站</Title>
      <Text type="secondary">回收站页面 30 天后由系统自动彻底删除</Text>
      <Card style={{ marginTop: 16 }}>
        {isLoading ? null : (data?.data || []).length === 0 ? (
          <Empty description="回收站为空" />
        ) : (
          <List
            dataSource={data?.data || []}
            renderItem={(p: any) => (
              <List.Item
                actions={[
                  <Button
                    key="r"
                    icon={<RollbackOutlined />}
                    onClick={() => restore.mutate(p.id)}
                  >恢复</Button>,
                  <Button
                    key="d"
                    icon={<DeleteOutlined />}
                    danger
                    onClick={() => Modal.confirm({
                      title: '彻底删除？',
                      content: '版本/评论/附件挂载等关联数据将一并清理，操作不可恢复',
                      onOk: () => purge.mutate(p.id)
                    })}
                  >彻底删除</Button>
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{p.title}</span>
                      <Tag color="cyan">{p.space_name}</Tag>
                    </Space>
                  }
                  description={
                    <Text type="secondary">
                      删除于 {new Date(p.deleted_at).toLocaleString('zh-CN')} · 操作人 {p.deleter_name}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  )
}
