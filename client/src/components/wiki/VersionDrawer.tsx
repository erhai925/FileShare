import { useState } from 'react'
import { Drawer, List, Button, Space, Modal, Typography, Tag, Spin, message, Empty, Radio } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { diffLines } from 'diff'
import { wikiApi, WikiVersion } from '../../services/wikiService'

const { Text } = Typography

interface Props {
  pageId: number
  open: boolean
  onClose: () => void
  canRollback: boolean
}

export default function VersionDrawer({ pageId, open, onClose, canRollback }: Props) {
  const qc = useQueryClient()
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'versions', pageId],
    queryFn: () => wikiApi.listVersions(pageId),
    enabled: open
  })

  const { data: diffData } = useQuery({
    queryKey: ['wiki', 'diff', pageId, from, to],
    queryFn: () => wikiApi.diffVersions(pageId, from!, to!),
    enabled: !!(from && to && diffOpen)
  })

  const rollback = useMutation({
    mutationFn: (v: number) => wikiApi.rollback(pageId, v),
    onSuccess: () => {
      message.success('回滚成功')
      qc.invalidateQueries({ queryKey: ['wiki'] })
      onClose()
    },
    onError: (e: any) => message.error(e?.message || '回滚失败')
  })

  const versions = data?.data || []

  return (
    <>
      <Drawer
        title="版本历史"
        open={open}
        onClose={onClose}
        width={520}
        extra={
          <Space>
            {from && to && from !== to && (
              <Button type="primary" onClick={() => setDiffOpen(true)}>
                对比 v{from} ↔ v{to}
              </Button>
            )}
          </Space>
        }
      >
        {isLoading ? <Spin /> : versions.length === 0 ? (
          <Empty />
        ) : (
          <List
            dataSource={versions}
            renderItem={(v: WikiVersion) => (
              <List.Item
                actions={[
                  canRollback && versions[0].version !== v.version ? (
                    <Button
                      key="rollback"
                      size="small"
                      onClick={() => Modal.confirm({
                        title: `回滚到 v${v.version}？`,
                        content: '将以历史内容创建一个新版本（不会删除中间版本）',
                        onOk: () => rollback.mutate(v.version)
                      })}
                    >回滚</Button>
                  ) : null
                ].filter(Boolean) as any}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color="blue">v{v.version}</Tag>
                      <span>{v.title}</span>
                      {versions[0].version === v.version && <Tag color="green">当前</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {v.author_real_name || v.author_name} · {new Date(v.created_at).toLocaleString('zh-CN')}
                      </Text>
                      {v.change_note && <Text style={{ fontSize: 12 }}>{v.change_note}</Text>}
                      <Radio.Group
                        size="small"
                        value={from === v.version ? 'from' : to === v.version ? 'to' : ''}
                        onChange={(e) => {
                          if (e.target.value === 'from') setFrom(v.version)
                          else if (e.target.value === 'to') setTo(v.version)
                        }}
                      >
                        <Radio.Button value="from">设为左</Radio.Button>
                        <Radio.Button value="to">设为右</Radio.Button>
                      </Radio.Group>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      <Modal
        title={`差异：v${from} → v${to}`}
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        footer={null}
        width={900}
      >
        {diffData?.data ? (
          <div style={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 13,
            background: '#fafafa',
            padding: 12,
            border: '1px solid #eee',
            borderRadius: 4,
            maxHeight: '60vh',
            overflow: 'auto',
            whiteSpace: 'pre-wrap'
          }}>
            {diffLines(diffData.data.from.content || '', diffData.data.to.content || '').map((part, i) => (
              <div
                key={i}
                style={{
                  background: part.added ? '#e6ffed' : part.removed ? '#ffeef0' : 'transparent',
                  color: part.added ? '#22863a' : part.removed ? '#cb2431' : '#222'
                }}
              >
                {(part.added ? '+ ' : part.removed ? '- ' : '  ') + part.value}
              </div>
            ))}
          </div>
        ) : <Spin />}
      </Modal>
    </>
  )
}
